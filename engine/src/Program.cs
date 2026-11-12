// VL Scaling — hospedeiro do motor Lossless para o VL Optimizer (Electron).
//
// Por que existe um processo separado em vez de um addon Node:
// o motor precisa ser carregado numa thread STA com pilha grande, e a inicialização dele
// instala hooks de DXGI que pertencem à thread que chamou `Init`. Manter isso em C# num
// processo próprio deixa o motor isolado: se ele falhar, o Electron continua de pé e o erro
// volta como texto em vez de derrubar a janela.
//
// Protocolo: o Node manda uma linha JSON na entrada padrão, este programa responde uma linha
// JSON na saída padrão. Sem servidor, sem porta, sem dependência externa.
//
// Comandos:
//   {"cmd":"status"}                              → motor carregado? ativo? janela?
//   {"cmd":"start","width":1280,"height":720}     → carrega, inicializa e ativa
//   {"cmd":"apply", ...opções...}                 → envia a configuração ao motor
//   {"cmd":"stop"}                                → desativa e descarrega
//   {"cmd":"quit"}                                → encerra o processo

using System.Text.Json;
using System.Text.Json.Nodes;

namespace VLScalingHost;

internal static class Program
{
    private static readonly object Gate = new();
    private static EngineHost? host;
    private static string? lastError;

    private static int Main(string[] args)
    {
        // Saída em UTF-8 sem BOM: o Node lê linha a linha e não espera BOM.
        var stdout = new StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false)) { AutoFlush = true };
        Console.SetOut(stdout);
        Console.SetIn(new StreamReader(Console.OpenStandardInput(), System.Text.Encoding.UTF8));

        // Uma linha de "pronto" para o Node saber que o processo subiu de verdade.
        WriteLine(new JsonObject { ["event"] = "ready", ["pid"] = Environment.ProcessId });

        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            JsonObject? request;
            try { request = JsonNode.Parse(line) as JsonObject; }
            catch (JsonException ex) { WriteError("Pedido inválido: " + ex.Message); continue; }
            if (request is null) { WriteError("Pedido vazio."); continue; }

            string command = request["cmd"]?.GetValue<string>() ?? "";
            try
            {
                switch (command)
                {
                    case "status": Reply(Status()); break;
                    case "start": Reply(Start(request)); break;
                    case "apply": Reply(Apply(request)); break;
                    case "stop": Reply(Stop()); break;
                    case "quit": Reply(new JsonObject { ["ok"] = true }); return 0;
                    default: WriteError("Comando desconhecido: " + command); break;
                }
            }
            catch (Exception ex)
            {
                // Nunca deixa o processo morrer por causa de um comando: o Node ficaria esperando.
                lastError = ex.GetType().Name + ": " + ex.Message;
                WriteError(lastError);
            }
        }
        return 0;
    }

    private static JsonObject Status()
    {
        lock (Gate)
        {
            return new JsonObject
            {
                ["ok"] = true,
                ["loaded"] = host?.IsRunning == true,
                ["window"] = host?.OutputWindow.ToInt64() ?? 0,
                ["engine"] = host?.EnginePath,
                ["error"] = lastError,
            };
        }
    }

    private static JsonObject Start(JsonObject request)
    {
        int width = request["width"]?.GetValue<int>() ?? 1280;
        int height = request["height"]?.GetValue<int>() ?? 720;

        lock (Gate)
        {
            if (host?.IsRunning == true)
                return new JsonObject { ["ok"] = true, ["message"] = "Motor já estava ativo." };

            // O caminho da DLL vem do Node quando ele sabe; senão procura ao lado do executável
            // e na pasta bin do projeto. Sem isso o processo não tem como achar o motor.
            string? requested = request["dll"]?.GetValue<string>();
            string library = requested is { Length: > 0 } && File.Exists(requested)
                ? requested
                : LocateEngine();
            if (library.Length == 0)
            {
                lastError = "Lossless.dll não encontrado. Coloque o arquivo em bin\\.";
                return new JsonObject { ["ok"] = false, ["error"] = lastError };
            }

            host?.Dispose();
            host = new EngineHost();
            var start = host.Start(library, width, height);
            if (!start.Running)
            {
                lastError = start.Message;
                return new JsonObject { ["ok"] = false, ["error"] = start.Message };
            }
            lastError = null;
            return new JsonObject
            {
                ["ok"] = true,
                ["message"] = start.Message,
                ["window"] = host.OutputWindow.ToInt64(),
                ["engine"] = library,
            };
        }
    }

    private static JsonObject Apply(JsonObject request)
    {
        lock (Gate)
        {
            if (host?.IsRunning != true)
                return new JsonObject { ["ok"] = false, ["error"] = "Motor não está ativo." };

            bool ok = host.Apply(request, out string message);
            return new JsonObject { ["ok"] = ok, ["message"] = message };
        }
    }

    private static JsonObject Stop()
    {
        lock (Gate)
        {
            if (host is null) return new JsonObject { ["ok"] = true, ["message"] = "Motor já estava parado." };
            host.Stop();
            host.Dispose();
            host = null;
            return new JsonObject { ["ok"] = true, ["message"] = "Motor encerrado." };
        }
    }

    /// <summary>Procura o motor ao lado do executável e em bin\ do projeto. O hash é conferido
    /// por quem chama: este processo apenas encontra o arquivo.</summary>
    private static string LocateEngine()
    {
        foreach (string candidate in new[]
        {
            Path.Combine(AppContext.BaseDirectory, "Lossless.dll"),
            Path.Combine(AppContext.BaseDirectory, "bin", "Lossless.dll"),
            Path.Combine(AppContext.BaseDirectory, "..", "bin", "Lossless.dll"),
        })
        {
            string full = Path.GetFullPath(candidate);
            if (File.Exists(full)) return full;
        }
        return "";
    }

    private static void Reply(JsonObject payload)
    {
        payload["type"] = "reply";
        WriteLine(payload);
    }

    private static void WriteError(string message)
    {
        WriteLine(new JsonObject { ["type"] = "error", ["message"] = message });
    }

    private static void WriteLine(JsonObject payload)
    {
        try { Console.Out.WriteLine(payload.ToJsonString()); }
        catch (IOException) { /* o Node fechou a entrada: nada a fazer */ }
        catch (ObjectDisposedException) { }
    }
}
