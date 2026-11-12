// EngineHost — carrega o Lossless.dll e o conduz na ordem que o binário exige.
//
// O que foi descoberto lendo o binário e que este arquivo implementa:
//
// 1. O motor é um COMPOSITOR EXTERNO, não algo injetado no jogo. Ele captura a janela em primeiro
//    plano (DXGI Desktop Duplication / WGC) e apresenta o resultado na própria janela. Por isso o
//    jogo precisa estar em modo janela ou sem bordas: tela cheia exclusiva bloqueia a captura.
//
// 2. `Init` precisa ser chamado numa thread STA com pilha grande. Chamado da thread principal de um
//    console .NET comum, falha com 0xc0000005 em 0x0. Com STA e 16 MB de pilha, inicializa.
//
// 3. `Init` recebe um callback (arg1, em RCX) que ele guarda em [global.0x1800505d8] e que `Activate`
//    chama depois, com 4 argumentos zerados. Passar NULL faz o motor saltar para 0x0 e derrubar o
//    processo. O delegate precisa ficar vivo enquanto a sessão durar.
//
// 4. A ordem é: Init → criar a janela e a swapchain → Activate(hwnd). O motor instala os hooks de
//    DXGI durante o Init, então a janela que ele captura precisa existir antes do Activate.
//
// 5. `ApplySettings` NÃO recebe um ponteiro de struct: recebe 32 argumentos soltos, 4 em registrador
//    (ECX, EDX, R8D, R9D) e 28 na pilha a partir de RSP+0x28, em slots de 8 bytes.

using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace VLScalingHost;

internal sealed class EngineHost : IDisposable
{
    private const int MessageLoop = 0;
    private readonly List<byte[]> pinned = new();
    private Thread? thread;
    private volatile bool running;
    private nint library;
    private nint window;
    private EngineCallback? callback;   // campo, não local: o delegate precisa sobreviver ao GC

    public nint OutputWindow { get { lock (this) return window; } }
    public string? EnginePath { get; private set; }
    public bool IsRunning => running;

    public readonly record struct StartResult(bool Running, string Message);

    public StartResult Start(string libraryPath, int width, int height)
    {
        lock (this)
        {
            if (running) return new StartResult(true, "Motor já estava ativo.");
            EnginePath = libraryPath;
            var ready = new ManualResetEventSlim(false);
            string message = "";
            bool ok = false;

            // STA e 16 MB de pilha: exigência do motor, não preferência.
            thread = new Thread(() =>
            {
                try { ok = RunEngine(libraryPath, width, height, out message); }
                catch (Exception ex) { message = ex.GetType().Name + ": " + ex.Message; ok = false; }
                finally { ready.Set(); }
                if (ok) PumpUntilStopped();
            }, 16 * 1024 * 1024) { IsBackground = true, Name = "VLScalingEngine" };
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();

            if (!ready.Wait(TimeSpan.FromSeconds(30)))
                return new StartResult(false, "O motor não respondeu em 30 segundos.");
            running = ok;
            return new StartResult(ok, ok ? "Motor ativo: captura a janela em primeiro plano." : message);
        }
    }

    private bool RunEngine(string libraryPath, int width, int height, out string message)
    {
        message = "";
        if (!NativeLibrary.TryLoad(libraryPath, out library))
        {
            message = "Não foi possível carregar o motor. Verifique se o arquivo é x64.";
            return false;
        }
        if (!NativeLibrary.TryGetExport(library, "Init", out var init) ||
            !NativeLibrary.TryGetExport(library, "Activate", out var activate))
        {
            message = "O arquivo não expõe Init/Activate. Não parece ser o motor.";
            return false;
        }

        callback = OnEngineCallback;
        // Init tem assinatura variada entre versões: até 3 argumentos, o primeiro é o callback.
        var initFn = Marshal.GetDelegateForFunctionPointer<InitDelegate>(init);
        try { initFn(callback); }
        catch (Exception ex) { message = "Init falhou: " + ex.Message; return false; }

        window = CreateOutputWindow(width, height);
        if (window == 0) { message = "Não foi possível criar a janela de saída."; return false; }

        var activateFn = Marshal.GetDelegateForFunctionPointer<ActivateDelegate>(activate);
        try { activateFn(window); }
        catch (Exception ex) { message = "Activate falhou: " + ex.Message; return false; }
        return true;
    }

    /// <summary>Bomba de mensagens: a janela só vive enquanto a thread despacha WM_*, e o motor
    /// depende dela para apresentar.</summary>
    private void PumpUntilStopped()
    {
        while (running)
        {
            while (PeekMessage(out var msg, 0, 0, 0, 1))
            {
                if (msg.Message == 0x0012) { running = false; break; }   // WM_QUIT
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
            Thread.Sleep(8);
        }
    }

    public bool Apply(JsonObject options, out string message)
    {
        lock (this)
        {
            message = "";
            if (library == 0) { message = "Motor não carregado."; return false; }
            if (!NativeLibrary.TryGetExport(library, "ApplySettings", out var apply))
            {
                message = "O motor não expõe ApplySettings.";
                return false;
            }

            // 32 argumentos na ordem provada pelo disassembly do binário:
            //   arg1 ECX, arg2 EDX, arg3 R8D, arg4 R9D, depois RSP+0x28 + 8*(n-5).
            // A ordem correta importa: um slot trocado faz o motor rodar com configuração errada
            // sem reclamar, e o sintoma é a janela preta (ele captura, mas não escala).
            //
            // Os valores abaixo reproduzem o Settings.xml que o próprio Lossless grava:
            //   ScalingMode=Auto(1)  ScalingFitMode=Fullscreen(1)  CaptureApi=DXGI(0)
            //   WindowedMode=false   SyncMode=VSYNC2(2)           MaxFrameLatency=1
            //   QueueTarget=1        GsyncSupport=true            Vrs=true
            var arguments = new long[32];
            arguments[0]  = options["mode"]?.GetValue<int>() ?? 1;              // ECX  ScalingMode
            arguments[1]  = options["fitMode"]?.GetValue<int>() ?? 1;           // EDX  ScalingFitMode
            arguments[2]  = options["method"]?.GetValue<int>() ?? 5;            // R8D  ScalingType
            arguments[3]  = options["subtype"]?.GetValue<int>() ?? 0;           // R9D
            arguments[4]  = ToScaled(options["scaleFactor"]?.GetValue<double>() ?? 1.5); // RSP+0x28 float
            arguments[5]  = options["resizeBeforeScaling"]?.GetValue<int>() ?? 0;        // RSP+0x30 byte
            arguments[6]  = ToSharp(options["sharpness"]?.GetValue<double>() ?? 0.0);    // RSP+0x38 int
            arguments[7]  = options["vrs"]?.GetValue<int>() ?? 1;                        // RSP+0x40 byte
            arguments[8]  = options["frameGeneration"]?.GetValue<int>() ?? 0;            // RSP+0x48
            arguments[9]  = options["frameGenerationSize"]?.GetValue<int>() ?? 0;        // RSP+0x50
            arguments[10] = options["fgMode"]?.GetValue<int>() ?? 0;                     // RSP+0x58
            arguments[11] = ToScaled(options["multiplier"]?.GetValue<double>() ?? 2);    // RSP+0x60 float
            arguments[12] = ToScaled(options["targetFps"]?.GetValue<double>() ?? 0);     // RSP+0x68 float
            arguments[13] = options["flowScale"]?.GetValue<int>() ?? 100;                // RSP+0x70 int
            arguments[14] = options["clipCursor"]?.GetValue<int>() ?? 1;                 // RSP+0x78 byte
            arguments[15] = options["cursorSensitivity"]?.GetValue<int>() ?? 0;          // RSP+0x80 byte
            arguments[16] = options["hideCursor"]?.GetValue<int>() ?? 0;                 // RSP+0x88 byte
            arguments[17] = options["scaleCursor"]?.GetValue<int>() ?? 0;                // RSP+0x90 byte
            arguments[18] = options["syncMode"]?.GetValue<int>() ?? 2;                   // RSP+0x98
            arguments[19] = options["maxFrameLatency"]?.GetValue<int>() ?? 1;            // RSP+0xa0
            arguments[20] = options["gsyncSupport"]?.GetValue<int>() ?? 1;               // RSP+0xa8 byte
            arguments[21] = options["hdrSupport"]?.GetValue<int>() ?? 0;                 // RSP+0xb0 byte
            arguments[22] = options["captureApi"]?.GetValue<int>() ?? 0;                 // RSP+0xb8
            arguments[23] = options["queueTarget"]?.GetValue<int>() ?? 1;                // RSP+0xc0
            arguments[24] = options["drawFps"]?.GetValue<int>() ?? 1;                    // RSP+0xc8 byte
            arguments[25] = options["gpuId"]?.GetValue<int>() ?? 0;                      // RSP+0xd0
            arguments[26] = options["displayId"]?.GetValue<int>() ?? 0;                  // RSP+0xd8
            // RSP+0xe0..0xf8: recorte da captura. Deixar 0 significa "tela inteira".
            arguments[27] = 0;
            arguments[28] = 0;
            arguments[29] = 0;
            arguments[30] = 0;
            arguments[31] = options["multiDisplayMode"]?.GetValue<int>() ?? 0;           // RSP+0x100 byte

            for (int i = 0; i < arguments.Length; i++)
            {
                var slot = BitConverter.GetBytes(arguments[i]);
                pinned.Add(slot);
            }

            var fn = Marshal.GetDelegateForFunctionPointer<ApplyDelegate>(apply);
            try
            {
                long result = fn(
                    (int)arguments[0], (int)arguments[1], (int)arguments[2], (int)arguments[3],
                    arguments[4],  arguments[5],  arguments[6],  arguments[7],
                    arguments[8],  arguments[9],  arguments[10], arguments[11],
                    arguments[12], arguments[13], arguments[14], arguments[15],
                    arguments[16], arguments[17], arguments[18], arguments[19],
                    arguments[20], arguments[21], arguments[22], arguments[23],
                    arguments[24], arguments[25], arguments[26], arguments[27],
                    arguments[28], arguments[29], arguments[30], arguments[31]);
                message = result == 0 ? "Configuração enviada ao motor." : "O motor recusou a configuração (" + result + ").";
                return result == 0;
            }
            catch (Exception ex)
            {
                message = "ApplySettings falhou: " + ex.Message;
                return false;
            }
        }
    }

    private static long ToScaled(double value)
    {
        // O motor recebe o fator de escala em ponto fixo de 16 bits.
        return (long)Math.Round(Math.Clamp(value, 0.1, 8.0) * 65536.0);
    }

    /// <summary>Nitidez: a interface usa 0..100 e o motor grava em Settings.xml 0..10.</summary>
    private static long ToSharp(double percent)
    {
        double clamped = Math.Clamp(percent, 0, 100);
        return (long)Math.Round(clamped / 10.0);
    }

    public void Stop()
    {
        running = false;
        lock (this)
        {
            if (library != 0 && NativeLibrary.TryGetExport(library, "Deactivate", out var deactivate))
            {
                try { Marshal.GetDelegateForFunctionPointer<ActivateDelegate>(deactivate)(0); }
                catch (Exception) { }
            }
            if (window != 0) { DestroyWindow(window); window = 0; }
        }
    }

    public void Dispose()
    {
        Stop();
        lock (this)
        {
            if (library != 0 && NativeLibrary.TryGetExport(library, "UnInit", out var uninit))
            {
                try { Marshal.GetDelegateForFunctionPointer<ActivateDelegate>(uninit)(0); }
                catch (Exception) { }
            }
            if (library != 0) { NativeLibrary.Free(library); library = 0; }
            callback = null;
            pinned.Clear();
        }
    }

    private void OnEngineCallback(nint a1, nint a2, nint a3, nint a4)
    {
        // O motor chama isto no teardown. Nada a fazer além de não falhar: uma exceção aqui
        // atravessaria a fronteira nativa e derrubaria o processo.
    }

    private static nint CreateOutputWindow(int width, int height)
    {
        // Janela própria onde o motor apresenta o jogo escalado.
        //
        // Estilo: WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN, sem caption.
        // Não uso WS_OVERLAPPEDWINDOW porque a barra de título apareceria em cima da imagem
        // escalada, e o motor desenha o frame inteiro na área do cliente.
        const uint style = 0x80000000   // WS_POPUP
                         | 0x10000000   // WS_VISIBLE
                         | 0x04000000   // WS_CLIPSIBLINGS
                         | 0x02000000;  // WS_CLIPCHILDREN

        nint instance = GetModuleHandle(null);
        var className = "VLScalingOutput";
        var wc = new WNDCLASSEX
        {
            cbSize = Marshal.SizeOf<WNDCLASSEX>(),
            style = 0x0020,                       // CS_OWNDC
            lpfnWndProc = DefWindowProc,
            hInstance = instance,
            lpszClassName = className,
        };
        if (RegisterClassEx(ref wc) == 0 && Marshal.GetLastWin32Error() != 1410) return 0; // 1410 = já registrada

        nint hwnd = CreateWindowEx(0, className, "VL Scaling", style, 40, 40, width, height,
            0, 0, instance, 0);
        if (hwnd == 0) return 0;

        // Sem WS_VISIBLE a janela nasce oculta e o motor não apresenta nada: garantir aqui,
        // porque o estilo pode ser mascarado pelo CreateWindowEx dependendo do tema.
        ShowWindow(hwnd, 5);   // SW_SHOW
        UpdateWindow(hwnd);
        return hwnd;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void EngineCallback(nint a1, nint a2, nint a3, nint a4);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate long InitDelegate(EngineCallback callback);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate long ActivateDelegate(nint hwnd);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate long ApplyDelegate(int a1, int a2, int a3, int a4,
        long a5, long a6, long a7, long a8, long a9, long a10, long a11, long a12,
        long a13, long a14, long a15, long a16, long a17, long a18, long a19, long a20,
        long a21, long a22, long a23, long a24, long a25, long a26, long a27, long a28,
        long a29, long a30, long a31, long a32);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSEX
    {
        public int cbSize; public uint style; public WndProc lpfnWndProc;
        public int cbClsExtra; public int cbWndExtra; public nint hInstance; public nint hIcon;
        public nint hCursor; public nint hbrBackground; public string? lpszMenuName;
        public string lpszClassName; public nint hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public nint hwnd; public uint Message; public nint wParam; public nint lParam;
        public uint Time; public int X; public int Y;
    }

    private delegate nint WndProc(nint hwnd, uint msg, nint wParam, nint lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern ushort RegisterClassEx(ref WNDCLASSEX wc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern nint CreateWindowEx(uint exStyle, string className, string windowName, uint style,
        int x, int y, int width, int height, nint parent, nint menu, nint instance, nint param);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(nint hwnd, int command);
    [DllImport("user32.dll")] private static extern bool UpdateWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern nint DefWindowProc(nint hwnd, uint msg, nint wParam, nint lParam);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out MSG msg, nint hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] private static extern nint DispatchMessage(ref MSG msg);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern nint GetModuleHandle(string? name);
}
