using System;
using System.ComponentModel;
using System.Windows.Forms;
using TFlex;

namespace TflexCodexBridge
{
    public class Factory : PluginFactory
    {
        public override Plugin CreateInstance()
        {
            return new BridgePlugin(this);
        }

        public override Guid ID
        {
            get { return new Guid("{76E1DCB8-4336-4B3A-B775-FD4E67F54A21}"); }
        }

        public override string Name
        {
            get { return "Codex MCP Bridge"; }
        }
    }

    public class BridgePlugin : Plugin
    {
        private BridgeServer server;
        private System.Windows.Forms.Control dispatcher;

        public BridgePlugin(Factory factory) : base(factory)
        {
        }

        protected override void OnInitialize()
        {
            base.OnInitialize();
            dispatcher = new System.Windows.Forms.Control();
            IntPtr handle = dispatcher.Handle;
            server = new BridgeServer(new TflexOperations(), dispatcher);
            server.Start();
        }

        protected override void OnExiting(CancelEventArgs e)
        {
            if (server != null)
            {
                server.Dispose();
                server = null;
            }
            if (dispatcher != null)
            {
                dispatcher.Dispose();
                dispatcher = null;
            }
            base.OnExiting(e);
        }
    }
}
