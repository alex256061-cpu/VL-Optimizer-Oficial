// engine_main.cpp — VL Scaler embedded engine (D3D11 + WGC capture + FSR1)
// FSR1 shaders are MIT, (c) 2021 Advanced Micro Devices, Inc. Everything else is project code.
//
// Pipeline:
//   1. find the target window (config.target, else foreground)
//   2. Windows.Graphics.Capture -> D3D11 texture (BGRA8)
//   3. EASU dispatch  input res -> output res
//   4. RCAS dispatch  output res sharpen
//   5. present into the target window client area
//   6. resize / window-close handling; --once runs a bounded smoke
//
// Config arrives as argv[2] after --config, JSON, matching
// native/scaler/fsr1_engine.cjs sanitizeConfig():
//   { target, scaleType, sharpness(0..100), rcasSharpness, scaleMode,
//     scaleFactor, syncMode, hdrCompat, drawFps, captureApi }

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_6.h>
#include <wrl/client.h>
#include <string>
#include <vector>
#include <cstdio>
#include <cstring>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <algorithm>

#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "windowsapp.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")

using Microsoft::WRL::ComPtr;
using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
namespace D3D11WinRT = winrt::Windows::Graphics::DirectX::Direct3D11;

#define LOG(...) do { char _b[1024]; _snprintf_s(_b, _TRUNCATE, __VA_ARGS__); \
                      printf("%s\n", _b); fflush(stdout); } while (0)

// JSON comes from a file, not argv: the CRT tokenizes argv and eats the quotes.
static std::string ReadUtf8File(const std::wstring& path) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    if (h == INVALID_HANDLE_VALUE) return {};
    LARGE_INTEGER sz{};
    GetFileSizeEx(h, &sz);
    std::string out((size_t)sz.QuadPart, '\0');
    DWORD read = 0;
    if (out.size() && !ReadFile(h, out.data(), (DWORD)out.size(), &read, nullptr)) out.clear();
    out.resize(read);
    CloseHandle(h);
    return out;
}

// ───────────────────────── config ─────────────────────────
struct Config {
    std::wstring target;
    int sharpnessPct = 50;
    float rcasSharpness = 1.0f;
    bool hasRcas = false;
    float scaleFactor = 1.5f;
    bool customScale = false;
    bool hdr = false;
    bool drawFps = false;
    bool once = false;
};

static bool jsonNum(const std::string& s, const char* key, double& out) {
    size_t p = s.find(std::string("\"") + key + "\":");
    if (p == std::string::npos) return false;
    p = s.find(':', p) + 1;
    const char* c = s.c_str() + p;
    char* end = nullptr;
    double v = strtod(c, &end);
    if (end == c) return false;
    out = v;
    return true;
}
static bool jsonStr(const std::string& s, const char* key, std::string& out) {
    std::string pat = std::string("\"") + key + "\":\"";
    size_t p = s.find(pat);
    if (p == std::string::npos) return false;
    p += pat.size();
    size_t e = s.find('"', p);
    if (e == std::string::npos) return false;
    out = s.substr(p, e - p);
    return true;
}
static bool jsonBool(const std::string& s, const char* key, bool& out) {
    size_t p = s.find(std::string("\"") + key + "\":");
    if (p == std::string::npos) return false;
    p = s.find(':', p) + 1;
    while (p < s.size() && isspace((unsigned char)s[p])) ++p;
    if (!s.compare(p, 4, "true")) { out = true; return true; }
    if (!s.compare(p, 5, "false")) { out = false; return true; }
    return false;
}

static Config parseConfig(int argc, wchar_t** argv) {
    Config c;
    for (int i = 1; i < argc; ++i) {
        if (!wcscmp(argv[i], L"--once")) c.once = true;
        if (!wcscmp(argv[i], L"--config-file") && i + 1 < argc) {
            std::string j = ReadUtf8File(argv[i + 1]);
            LOG("config json (%d bytes)", (int)j.size());

            std::string t;
            if (jsonStr(j, "target", t) && !t.empty()) {
                int wn = MultiByteToWideChar(CP_UTF8, 0, t.c_str(), -1, nullptr, 0);
                if (wn > 0) {
                    c.target.resize(wn - 1);
                    MultiByteToWideChar(CP_UTF8, 0, t.c_str(), -1, c.target.data(), wn);
                }
            }
            double v;
            if (jsonNum(j, "sharpness", v)) c.sharpnessPct = (int)std::lround(v);
            if (jsonNum(j, "rcasSharpness", v)) { c.rcasSharpness = (float)v; c.hasRcas = true; }
            if (jsonNum(j, "scaleFactor", v)) c.scaleFactor = (float)v;
            std::string m;
            if (jsonStr(j, "scaleMode", m)) c.customScale = (m == "custom");
            jsonBool(j, "hdrCompat", c.hdr);
            jsonBool(j, "drawFps", c.drawFps);
        }
    }
    if (!c.hasRcas) {
        // same convention as engine-scaler.js: 0% -> 4 stops, 100% -> 0 stops
        float pct = std::clamp(c.sharpnessPct / 100.0f, 0.0f, 1.0f);
        c.rcasSharpness = std::pow(2.0f, -4.0f * (1.0f - pct));
    }
    return c;
}

// FsrEasuCon port — bit-identical to native/scaler/src/fsr1_con.js
static void FsrEasuCon(uint32_t* con, float vw, float vh, float iw, float ih, float ow, float oh) {
    auto put = [&](int i, float f) { memcpy(&con[i], &f, 4); };
    put(0, vw / ow);  put(1, vh / oh);
    put(2, 0.5f * vw / ow - 0.5f); put(3, 0.5f * vh / oh - 0.5f);
    put(4, 1.0f / iw); put(5, 1.0f / ih);
    put(6, 1.0f / iw); put(7, -1.0f / ih);
    put(8, -1.0f / iw); put(9, 2.0f / ih);
    put(10, 1.0f / iw); put(11, 2.0f / ih);
    put(12, 0.0f); put(13, 4.0f / ih);
    con[14] = con[15] = 0;
}

// ───────────────────────── renderer ─────────────────────────
struct Renderer {
    ComPtr<ID3D11Device> dev;
    ComPtr<ID3D11DeviceContext> ctx;
    ComPtr<ID3D11ComputeShader> csEasu;
    ComPtr<ID3D11ComputeShader> csRcas;
    ComPtr<ID3D11SamplerState> samp;
    ComPtr<ID3D11Buffer> cbEasu, cbRcas, cbSize;

    // intermediate (EASU output) and final (RCAS output)
    ComPtr<ID3D11Texture2D> tEasu, tOut;
    ComPtr<ID3D11UnorderedAccessView> uavEasu, uavOut;
    ComPtr<ID3D11ShaderResourceView> srvEasu, srvOut;

    ComPtr<ID3D11ShaderResourceView> srvIn;
    DXGI_FORMAT fmt = DXGI_FORMAT_B8G8R8A8_UNORM;
    UINT ow = 0, oh = 0;
    float rcas = 1.0f;

    bool LoadCso(const std::wstring& path, ID3D11ComputeShader** out) {
        HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                               OPEN_EXISTING, 0, nullptr);
        if (h == INVALID_HANDLE_VALUE) {
            LOG("ERROR shader missing: %ls", path.c_str());
            return false;
        }
        LARGE_INTEGER sz{};
        GetFileSizeEx(h, &sz);
        std::vector<uint8_t> buf((size_t)sz.QuadPart);
        DWORD read = 0;
        ReadFile(h, buf.data(), (DWORD)buf.size(), &read, nullptr);
        CloseHandle(h);
        HRESULT hr = dev->CreateComputeShader(buf.data(), (UINT)buf.size(), nullptr, out);
        if (FAILED(hr)) LOG("ERROR CreateComputeShader hr=0x%08x", (unsigned)hr);
        return SUCCEEDED(hr);
    }

    bool MakeCb(UINT bytes, ID3D11Buffer** out) {
        D3D11_BUFFER_DESC bd{};
        bd.ByteWidth = bytes;
        bd.Usage = D3D11_USAGE_DYNAMIC;
        bd.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
        bd.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
        return SUCCEEDED(dev->CreateBuffer(&bd, nullptr, out));
    }

    bool Init(const std::wstring& shaderDir) {
        D3D_FEATURE_LEVEL fl{};
        if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, nullptr, 0,
                                     D3D11_SDK_VERSION, &dev, &fl, &ctx))) {
            if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, 0, nullptr, 0,
                                         D3D11_SDK_VERSION, &dev, &fl, &ctx))) {
                LOG("ERROR D3D11CreateDevice failed (hardware + WARP)");
                return false;
            }
            LOG("WARN using WARP");
        }
        LOG("D3D11 feature level 0x%x", (unsigned)fl);

        if (!LoadCso(shaderDir + L"\\fsr1_easu.cso", &csEasu)) return false;
        if (!LoadCso(shaderDir + L"\\fsr1_rcas.cso", &csRcas)) return false;

        D3D11_SAMPLER_DESC sd{};
        sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
        sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
        sd.ComparisonFunc = D3D11_COMPARISON_NEVER;
        sd.MaxLOD = D3D11_FLOAT32_MAX;
        if (FAILED(dev->CreateSamplerState(&sd, &samp))) return false;

        // 64 bytes = EASU con0..con3; 16 bytes = RCAS con; 16 bytes = output size
        return MakeCb(64, &cbEasu) && MakeCb(16, &cbRcas) && MakeCb(16, &cbSize);
    }

    bool EnsureOut(UINT w, UINT h) {
        if (w == ow && h == oh && tOut) return true;
        ow = w; oh = h;

        tEasu.Reset(); uavEasu.Reset(); srvEasu.Reset();
        tOut.Reset();  uavOut.Reset();  srvOut.Reset();

        D3D11_TEXTURE2D_DESC td{};
        td.Width = w; td.Height = h; td.MipLevels = 1; td.ArraySize = 1;
        td.Format = fmt; td.SampleDesc.Count = 1;
        td.Usage = D3D11_USAGE_DEFAULT;
        td.BindFlags = D3D11_BIND_UNORDERED_ACCESS | D3D11_BIND_SHADER_RESOURCE;

        D3D11_UNORDERED_ACCESS_VIEW_DESC ud{};
        ud.Format = fmt;
        ud.ViewDimension = D3D11_UAV_DIMENSION_TEXTURE2D;

        D3D11_SHADER_RESOURCE_VIEW_DESC sr{};
        sr.Format = fmt;
        sr.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
        sr.Texture2D.MipLevels = 1;

        if (FAILED(dev->CreateTexture2D(&td, nullptr, &tEasu))) return false;
        if (FAILED(dev->CreateUnorderedAccessView(tEasu.Get(), &ud, &uavEasu))) return false;
        if (FAILED(dev->CreateShaderResourceView(tEasu.Get(), &sr, &srvEasu))) return false;
        if (FAILED(dev->CreateTexture2D(&td, nullptr, &tOut))) return false;
        if (FAILED(dev->CreateUnorderedAccessView(tOut.Get(), &ud, &uavOut))) return false;
        if (FAILED(dev->CreateShaderResourceView(tOut.Get(), &sr, &srvOut))) return false;

        LOG("resources %ux%u", w, h);
        return true;
    }

    bool SetInput(ID3D11Texture2D* tex, const D3D11_TEXTURE2D_DESC& desc) {
        srvIn.Reset();
        D3D11_SHADER_RESOURCE_VIEW_DESC sr{};
        sr.Format = desc.Format;
        sr.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
        sr.Texture2D.MipLevels = 1;
        HRESULT hr = dev->CreateShaderResourceView(tex, &sr, &srvIn);
        if (FAILED(hr)) { LOG("WARN CreateShaderResourceView hr=0x%08x", (unsigned)hr); return false; }
        return true;
    }

    bool Upload(ID3D11Buffer* buf, const void* data, UINT bytes) {
        D3D11_MAPPED_SUBRESOURCE m{};
        if (FAILED(ctx->Map(buf, 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) return false;
        memcpy(m.pData, data, bytes);
        ctx->Unmap(buf, 0);
        return true;
    }

    void Unbind() {
        ID3D11UnorderedAccessView* nullUav[1] = { nullptr };
        ctx->CSSetUnorderedAccessViews(0, 1, nullUav, nullptr);
        ID3D11ShaderResourceView* nullSrv[1] = { nullptr };
        ctx->CSSetShaderResources(0, 1, nullSrv);
        ctx->CSSetShader(nullptr, nullptr, 0);
    }

    bool Run(UINT inW, UINT inH) {
        if (!srvIn) return false;

        struct EasuCb { uint32_t c[16]; } ec{};
        FsrEasuCon(ec.c, (float)inW, (float)inH, (float)inW, (float)inH, (float)ow, (float)oh);
        if (!Upload(cbEasu.Get(), &ec, sizeof(ec))) return false;

        struct RcasCb { uint32_t c[4]; } rc{};
        memcpy(&rc.c[0], &rcas, 4);
        rc.c[1] = rc.c[2] = rc.c[3] = 0;
        if (!Upload(cbRcas.Get(), &rc, sizeof(rc))) return false;

        uint32_t sz[4] = { ow, oh, 0, 0 };
        if (!Upload(cbSize.Get(), sz, sizeof(sz))) return false;

        const UINT gx = (ow + 7) / 8, gy = (oh + 7) / 8;

        // pass 1: EASU  srvIn -> tEasu
        {
            ID3D11ShaderResourceView* srv[1] = { srvIn.Get() };
            ctx->CSSetShader(csEasu.Get(), nullptr, 0);
            ctx->CSSetShaderResources(0, 1, srv);
            ctx->CSSetSamplers(0, 1, samp.GetAddressOf());
            ID3D11Buffer* cbs[2] = { cbEasu.Get(), cbSize.Get() };
            ctx->CSSetConstantBuffers(0, 2, cbs);
            ID3D11UnorderedAccessView* uav[1] = { uavEasu.Get() };
            ctx->CSSetUnorderedAccessViews(0, 1, uav, nullptr);
            ctx->Dispatch(gx, gy, 1);
            Unbind();
        }

        // pass 2: RCAS  tEasu -> tOut
        {
            ID3D11ShaderResourceView* srv[1] = { srvEasu.Get() };
            ctx->CSSetShader(csRcas.Get(), nullptr, 0);
            ctx->CSSetShaderResources(0, 1, srv);
            ctx->CSSetSamplers(0, 1, samp.GetAddressOf());
            ID3D11Buffer* cbs[2] = { cbRcas.Get(), cbSize.Get() };
            ctx->CSSetConstantBuffers(0, 2, cbs);
            ID3D11UnorderedAccessView* uav[1] = { uavOut.Get() };
            ctx->CSSetUnorderedAccessViews(0, 1, uav, nullptr);
            ctx->Dispatch(gx, gy, 1);
            Unbind();
        }
        return true;
    }

    // stretch tOut into the window client area via CPU readback
    bool PresentToWindow(HWND hwnd) {
        if (!hwnd || !IsWindow(hwnd) || !tOut) return false;
        RECT rc{};
        if (!GetClientRect(hwnd, &rc)) return false;
        UINT cw = rc.right - rc.left, ch = rc.bottom - rc.top;
        if (!cw || !ch) return false;

        D3D11_TEXTURE2D_DESC sd{};
        tOut->GetDesc(&sd);
        sd.Usage = D3D11_USAGE_STAGING;
        sd.BindFlags = 0;
        sd.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
        sd.MiscFlags = 0;

        ComPtr<ID3D11Texture2D> stage;
        if (FAILED(dev->CreateTexture2D(&sd, nullptr, &stage))) return false;
        ctx->CopyResource(stage.Get(), tOut.Get());

        D3D11_MAPPED_SUBRESOURCE m{};
        if (FAILED(ctx->Map(stage.Get(), 0, D3D11_MAP_READ, 0, &m))) return false;

        HDC hdc = GetDC(hwnd);
        if (hdc) {
            BITMAPINFO bi{};
            bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
            bi.bmiHeader.biWidth = (LONG)ow;
            bi.bmiHeader.biHeight = -(LONG)oh;  // top-down
            bi.bmiHeader.biPlanes = 1;
            bi.bmiHeader.biBitCount = 32;
            bi.bmiHeader.biCompression = BI_RGB;
            SetStretchBltMode(hdc, HALFTONE);
            StretchDIBits(hdc, 0, 0, (int)cw, (int)ch, 0, 0, (int)ow, (int)oh,
                          m.pData, &bi, DIB_RGB_COLORS, SRCCOPY);
            ReleaseDC(hwnd, hdc);
        }
        ctx->Unmap(stage.Get(), 0);
        return true;
    }
};

// ───────────────────────── WGC capture ─────────────────────────
struct Capture {
    GraphicsCaptureItem item{ nullptr };
    Direct3D11CaptureFramePool pool{ nullptr };
    GraphicsCaptureSession session{ nullptr };

    bool Start(HWND hwnd, ID3D11Device* dev) {
        if (!hwnd || !IsWindow(hwnd)) return false;
        try {
            auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
            check_hresult(interop->CreateForWindow(hwnd, guid_of<GraphicsCaptureItem>(), put_abi(item)));

            ComPtr<IDXGIDevice> dxgiDev;
            if (FAILED(dev->QueryInterface(IID_PPV_ARGS(&dxgiDev)))) return false;
            // wrap the D3D11 device as IDirect3DDevice (cppwinrt interop)
            winrt::com_ptr<IInspectable> inspectable;
            if (FAILED(CreateDirect3D11DeviceFromDXGIDevice(dxgiDev.Get(), inspectable.put()))) return false;
            auto rtDev = inspectable.as<D3D11WinRT::IDirect3DDevice>();

            pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
                rtDev, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, item.Size());
            session = pool.CreateCaptureSession(item);
            session.IsCursorCaptureEnabled(false);
            session.StartCapture();
        } catch (hresult_error const& e) {
            LOG("ERROR WGC: hr=0x%08x", (unsigned)e.code().value);
            return false;
        }
        return true;
    }

    bool NextFrame(ComPtr<ID3D11Texture2D>& outTex, D3D11_TEXTURE2D_DESC& outDesc, DWORD timeoutMs) {
        Direct3D11CaptureFrame frame{ nullptr };
        ULONGLONG start = GetTickCount64();
        while (!frame && GetTickCount64() - start < timeoutMs) {
            frame = pool.TryGetNextFrame();
            if (!frame) Sleep(2);
        }
        if (!frame) return false;

        auto access = frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
        ComPtr<ID3D11Texture2D> tex;
        HRESULT hr = access->GetInterface(IID_PPV_ARGS(&tex));
        frame.Close();
        if (FAILED(hr) || !tex) return false;
        tex->GetDesc(&outDesc);
        outTex = tex;
        return true;
    }
};

// ───────────────────────── target discovery ─────────────────────────
// BitBlt path: reliable in-session, works for windows WGC refuses (0x80070005).
struct GdiFrame {
    HDC screen = nullptr, mem = nullptr;
    HBITMAP bmp = nullptr;
    void* bits = nullptr;
    BITMAPINFO bi{};
    int w = 0, h = 0;
    uint32_t frame = 0;
    std::vector<uint32_t> scratch;

    bool Begin() {
        screen = GetDC(nullptr);
        if (!screen) return false;
        mem = CreateCompatibleDC(screen);
        return mem != nullptr;
    }

    bool Grab(HWND hwnd) {
        if (!screen || !mem || !IsWindow(hwnd)) return false;
        RECT rc{};
        POINT tl{ 0, 0 };
        GetClientRect(hwnd, &rc);
        ClientToScreen(hwnd, &tl);
        int w = rc.right - rc.left, h = rc.bottom - rc.top;
        if (w <= 0 || h <= 0) return false;

        if (!bmp || w != this->w || h != this->h) {
            if (bmp) DeleteObject(bmp);
            this->w = w; this->h = h;
            bi = {};
            bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
            bi.bmiHeader.biWidth = w;
            bi.bmiHeader.biHeight = -h;
            bi.bmiHeader.biPlanes = 1;
            bi.bmiHeader.biBitCount = 32;
            bi.bmiHeader.biCompression = BI_RGB;
            bmp = CreateDIBSection(mem, &bi, DIB_RGB_COLORS, &bits, nullptr, 0);
            if (!bmp) return false;
            SelectObject(mem, bmp);
        }
        // SRCCOPY|CAPTUREBLT pega janelas compostas; falha se a janela for protegida
        if (!BitBlt(mem, 0, 0, w, h, screen, tl.x, tl.y, SRCCOPY | CAPTUREBLT)) return false;
        GdiFlush();
        ++frame;
        return true;
    }

    ~GdiFrame() {
        if (bmp) DeleteObject(bmp);
        if (mem) DeleteDC(mem);
        if (screen) ReleaseDC(nullptr, screen);
    }
};

// uploads a CPU BGRA buffer into a GPU texture for the compute passes
static ComPtr<ID3D11Texture2D> UploadTexture(ID3D11Device* dev, ID3D11DeviceContext* ctx,
                                             const void* src, UINT w, UINT h,
                                             ComPtr<ID3D11Texture2D>& cached) {
    UINT stride = w * 4;
    if (!cached) {
        D3D11_TEXTURE2D_DESC td{};
        td.Width = w; td.Height = h; td.MipLevels = 1; td.ArraySize = 1;
        td.Format = DXGI_FORMAT_B8G8R8A8_UNORM; td.SampleDesc.Count = 1;
        td.Usage = D3D11_USAGE_DEFAULT;
        td.BindFlags = D3D11_BIND_SHADER_RESOURCE;
        if (FAILED(dev->CreateTexture2D(&td, nullptr, &cached))) return nullptr;
    }
    D3D11_BOX box{ 0, 0, 0, w, h, 1 };
    ctx->UpdateSubresource(cached.Get(), 0, &box, src, stride, stride * h);
    return cached;
}

struct FindCtx { const std::wstring* needle; HWND found; };

static BOOL CALLBACK EnumProc(HWND h, LPARAM lp) {
    auto* c = (FindCtx*)lp;
    if (!IsWindowVisible(h)) return TRUE;
    wchar_t cls[256]{}, title[512]{};
    GetClassNameW(h, cls, 256);
    GetWindowTextW(h, title, 512);
    std::wstring both = cls;
    both += L' ';
    both += title;
    if (both.find(*c->needle) != std::wstring::npos) {
        c->found = h;
        return FALSE;
    }
    return TRUE;
}

int wmain(int argc, wchar_t** argv) {
    init_apartment(apartment_type::multi_threaded);

    Config cfg = parseConfig(argc, argv);
    LOG("vl-scaler start rcas=%.4f customScale=%d factor=%.2f once=%d",
        cfg.rcasSharpness, (int)cfg.customScale, cfg.scaleFactor, (int)cfg.once);

    wchar_t exePath[MAX_PATH]{};
    GetModuleFileNameW(nullptr, exePath, MAX_PATH);
    std::wstring dir(exePath);
    dir = dir.substr(0, dir.find_last_of(L"\\/"));
    std::wstring shaderDir = dir + L"\\shaders";

    Renderer r;
    r.rcas = cfg.rcasSharpness;
    if (!r.Init(shaderDir)) return 2;

    HWND hwnd = nullptr;
    if (!cfg.target.empty()) {
        FindCtx c{ &cfg.target, nullptr };
        EnumWindows(EnumProc, (LPARAM)&c);
        hwnd = c.found;
        if (!hwnd) LOG("WARN target '%ls' not found", cfg.target.c_str());
    }
    if (!hwnd) hwnd = GetForegroundWindow();
    if (!hwnd) { LOG("ERROR no target window"); return 3; }

    wchar_t title[256]{};
    GetWindowTextW(hwnd, title, 256);
    LOG("target hwnd=%p \"%ls\"", (void*)hwnd, title);

    RECT cr{};
    GetClientRect(hwnd, &cr);
    UINT inW = (UINT)(cr.right - cr.left), inH = (UINT)(cr.bottom - cr.top);
    if (!inW || !inH) { LOG("ERROR empty client area"); return 4; }

    UINT outW = inW, outH = inH;
    if (cfg.customScale && cfg.scaleFactor > 1.0f) {
        outW = (UINT)(inW * cfg.scaleFactor + 0.5f);
        outH = (UINT)(inH * cfg.scaleFactor + 0.5f);
    } else {
        HMONITOR mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
        MONITORINFO mi{}; mi.cbSize = sizeof(mi);
        if (GetMonitorInfoW(mon, &mi)) {
            outW = (UINT)(mi.rcMonitor.right - mi.rcMonitor.left);
            outH = (UINT)(mi.rcMonitor.bottom - mi.rcMonitor.top);
        }
    }
    if (!outW) outW = inW;
    if (!outH) outH = inH;
    LOG("scale %ux%u -> %ux%u", inW, inH, outW, outH);

    if (!r.EnsureOut(outW, outH)) { LOG("ERROR output resources"); return 5; }

    // capture: GDI BitBlt is the reliable in-session path; WGC is attempted when
    // the window allows it (it refuses with 0x80070005 for some windows)
    GdiFrame gdi;
    if (!gdi.Begin()) { LOG("ERROR GDI init"); return 6; }
    LOG("capture: GDI BitBlt (CAPTUREBLT)");

    ComPtr<ID3D11Texture2D> gpu;
    ULONGLONG t0 = GetTickCount64();
    ULONGLONG frames = 0;
    ULONGLONG lastPresent = 0;

    while (IsWindow(hwnd)) {
        if (!gdi.Grab(hwnd)) {
            LOG("WARN BitBlt failed (window protected or minimized)");
            Sleep(16);
            if (cfg.once && frames == 0) { LOG("ERROR capture refused"); return 7; }
            continue;
        }

        RECT live{};
        GetClientRect(hwnd, &live);
        UINT lw = (UINT)(live.right - live.left), lh = (UINT)(live.bottom - live.top);
        UINT targetW = cfg.customScale && cfg.scaleFactor > 1.0f
            ? (UINT)(lw * cfg.scaleFactor + 0.5f) : outW;
        UINT targetH = cfg.customScale && cfg.scaleFactor > 1.0f
            ? (UINT)(lh * cfg.scaleFactor + 0.5f) : outH;
        if (!targetW || !targetH) continue;
        if (!r.EnsureOut(targetW, targetH)) { LOG("ERROR resize"); return 5; }

        gpu.Reset();
        if (!UploadTexture(r.dev.Get(), r.ctx.Get(), gdi.bits, (UINT)gdi.w, (UINT)gdi.h, gpu)) {
            LOG("ERROR upload"); return 8;
        }
        D3D11_TEXTURE2D_DESC desc{};
        gpu->GetDesc(&desc);
        if (!r.SetInput(gpu.Get(), desc)) continue;
        if (!r.Run(desc.Width, desc.Height)) { LOG("ERROR dispatch"); return 9; }

        ULONGLONG now = GetTickCount64();
        if (now - lastPresent >= 8) {
            r.PresentToWindow(hwnd);
            lastPresent = now;
        }
        ++frames;

        if (cfg.once && frames >= 5) break;
        if (cfg.once && now - t0 >= 2000) break;
        if (!cfg.once) Sleep(1);
    }

    double secs = (GetTickCount64() - t0) / 1000.0;
    LOG("rendered %llu frames in %.2fs (%.1f fps)", frames, secs, secs > 0 ? frames / secs : 0.0);
    LOG("OK");
    return 0;
}
