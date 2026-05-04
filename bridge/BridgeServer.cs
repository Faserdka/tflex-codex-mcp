using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace TflexCodexBridge
{
    public sealed class BridgeServer : IDisposable
    {
        private const string Prefix = "http://127.0.0.1:38517/";
        private readonly HttpListener listener = new HttpListener();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly TflexOperations operations;
        private readonly ISynchronizeInvoke dispatcher;
        private Thread thread;
        private bool running;

        public BridgeServer(TflexOperations operations, ISynchronizeInvoke dispatcher)
        {
            this.operations = operations;
            this.dispatcher = dispatcher;
            listener.Prefixes.Add(Prefix);
        }

        public void Start()
        {
            if (running)
                return;

            running = true;
            listener.Start();
            thread = new Thread(ListenLoop);
            thread.IsBackground = true;
            thread.Name = "Codex T-FLEX Bridge";
            thread.Start();
        }

        public void Dispose()
        {
            running = false;
            try { listener.Stop(); } catch { }
            try { listener.Close(); } catch { }
        }

        private void ListenLoop()
        {
            while (running)
            {
                try
                {
                    HttpListenerContext context = listener.GetContext();
                    ThreadPool.QueueUserWorkItem(_ => Handle(context));
                }
                catch
                {
                    if (!running)
                        return;
                }
            }
        }

        private void Handle(HttpListenerContext context)
        {
            try
            {
                if (context.Request.HttpMethod != "POST" || context.Request.Url.AbsolutePath != "/command")
                {
                    Write(context, 404, new Dictionary<string, object> { { "ok", false }, { "error", "POST /command expected" } });
                    return;
                }

                string body;
                using (var reader = new StreamReader(context.Request.InputStream, Encoding.UTF8))
                    body = reader.ReadToEnd();

                var request = json.DeserializeObject(body) as Dictionary<string, object>;
                if (request == null || !request.ContainsKey("command"))
                {
                    Write(context, 400, new Dictionary<string, object> { { "ok", false }, { "error", "Invalid request" } });
                    return;
                }

                string command = Convert.ToString(request["command"]);
                var args = request.ContainsKey("args") ? request["args"] as Dictionary<string, object> : null;
                var result = ExecuteOnDispatcher(command, args ?? new Dictionary<string, object>());
                Write(context, 200, result);
            }
            catch (Exception ex)
            {
                Write(context, 500, new Dictionary<string, object> { { "ok", false }, { "error", ex.Message }, { "type", ex.GetType().FullName } });
            }
        }

        private Dictionary<string, object> ExecuteOnDispatcher(string command, Dictionary<string, object> args)
        {
            if (dispatcher != null && dispatcher.InvokeRequired)
            {
                return (Dictionary<string, object>)dispatcher.Invoke(
                    new Func<Dictionary<string, object>>(() => operations.Execute(command, args)),
                    null);
            }

            return operations.Execute(command, args);
        }

        private void Write(HttpListenerContext context, int status, object value)
        {
            string text = json.Serialize(value);
            byte[] bytes = Encoding.UTF8.GetBytes(text);
            context.Response.StatusCode = status;
            context.Response.ContentType = "application/json; charset=utf-8";
            context.Response.ContentLength64 = bytes.Length;
            context.Response.OutputStream.Write(bytes, 0, bytes.Length);
            context.Response.Close();
        }
    }
}
