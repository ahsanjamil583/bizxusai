import { useEffect, useMemo, useState } from "react";

import { useModules } from "../../context/ModuleContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import {
  disconnectWhatsApp,
  getWhatsAppConversations,
  getWhatsAppSettings,
  saveWhatsAppSettings,
  sendWhatsAppTest,
  simulateWhatsAppInbound,
} from "../../services/whatsappApi.js";

const defaultForm = {
  provider: "mock",
  businessWhatsAppNumber: "",
  displayName: "",
  phoneNumberId: "",
  accessToken: "",
  apiVersion: "v21.0",
  autoReplyEnabled: true,
  handoffEnabled: true,
  handoffKeywords: "human, agent, admin, owner",
  welcomeMessage:
    "Assalam o Alaikum! Main BizXus AI assistant hoon. Aap products, prices, timing ya order ke bare mein pooch sakte hain.",
};

function toKeywordList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function formatDate(value) {
  if (!value) return "Not yet";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Not yet";
  }
}

export function WhatsAppAgentPage() {
  const { selectedTenant, isLoadingTenants } = useTenant();
  const { enabledModules, isLoadingModules } = useModules();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(defaultForm);
  const [mockForm, setMockForm] = useState({ customerPhone: "+923001234567", customerName: "Demo Customer", messageText: "2 burgers order kar do" });
  const [testForm, setTestForm] = useState({ toPhone: "+923001234567", messageText: "BizXus WhatsApp agent test message." });
  const [conversations, setConversations] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);

  const aiEnabled = enabledModules.includes("ai_chat");
  const whatsappEnabled = enabledModules.includes("whatsapp_agent");
  const connected = Boolean(settings?.isConnected);
  const webhookUrl = useMemo(() => {
    const base = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api/v1";
    return `${base.replace(/\/$/, "")}/webhooks/whatsapp`;
  }, []);

  async function loadWorkspace() {
    if (!selectedTenant || !aiEnabled || !whatsappEnabled) {
      setSettings(null);
      setConversations([]);
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const data = await getWhatsAppSettings(selectedTenant.id);
      const nextSettings = data.settings || {};
      setSettings(nextSettings);
      setForm({
        ...defaultForm,
        provider: nextSettings.provider || "mock",
        businessWhatsAppNumber: nextSettings.businessWhatsAppNumber || selectedTenant.contact?.whatsapp || selectedTenant.contact?.phone || "",
        displayName: nextSettings.displayName || selectedTenant.name || "",
        phoneNumberId: nextSettings.phoneNumberId || "",
        accessToken: "",
        apiVersion: nextSettings.apiVersion || "v21.0",
        autoReplyEnabled: nextSettings.autoReplyEnabled !== false,
        handoffEnabled: nextSettings.handoffEnabled !== false,
        handoffKeywords: (nextSettings.handoffKeywords || defaultForm.handoffKeywords.split(",")).join(", "),
        welcomeMessage: nextSettings.welcomeMessage || defaultForm.welcomeMessage,
      });
      const conversationData = await getWhatsAppConversations(selectedTenant.id, { page: 1, limit: 8 });
      setConversations(conversationData.items || []);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to load WhatsApp agent settings.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspace().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenant?.id, aiEnabled, whatsappEnabled]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!selectedTenant) return;
    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const data = await saveWhatsAppSettings(selectedTenant.id, {
        provider: form.provider,
        businessWhatsAppNumber: form.businessWhatsAppNumber,
        displayName: form.displayName,
        phoneNumberId: form.phoneNumberId,
        accessToken: form.accessToken,
        apiVersion: form.apiVersion,
        autoReplyEnabled: form.autoReplyEnabled,
        handoffEnabled: form.handoffEnabled,
        handoffKeywords: toKeywordList(form.handoffKeywords),
        welcomeMessage: form.welcomeMessage,
      });
      setSettings(data.settings);
      setForm((current) => ({ ...current, accessToken: "" }));
      setNotice("WhatsApp agent settings saved successfully.");
      await loadWorkspace();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to save WhatsApp settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!selectedTenant) return;
    const confirmed = window.confirm("Disconnect the WhatsApp agent for this business?");
    if (!confirmed) return;
    setError("");
    setNotice("");
    try {
      const data = await disconnectWhatsApp(selectedTenant.id);
      setSettings(data.settings);
      setNotice("WhatsApp agent disconnected.");
      await loadWorkspace();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to disconnect WhatsApp agent.");
    }
  }

  async function handleMockInbound(event) {
    event.preventDefault();
    if (!selectedTenant) return;
    setIsSimulating(true);
    setError("");
    setNotice("");
    setLastResult(null);
    try {
      const data = await simulateWhatsAppInbound(selectedTenant.id, mockForm);
      setLastResult(data);
      setNotice("Mock customer message processed by the WhatsApp AI agent.");
      await loadWorkspace();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to process mock WhatsApp message.");
    } finally {
      setIsSimulating(false);
    }
  }

  async function handleSendTest(event) {
    event.preventDefault();
    if (!selectedTenant) return;
    setIsSendingTest(true);
    setError("");
    setNotice("");
    try {
      await sendWhatsAppTest(selectedTenant.id, testForm);
      setNotice("Test message logged/sent successfully.");
      await loadWorkspace();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to send WhatsApp test message.");
    } finally {
      setIsSendingTest(false);
    }
  }

  if (isLoadingTenants || isLoadingModules) {
    return <section className="text-sm text-muted">Loading WhatsApp agent workspace...</section>;
  }

  if (!selectedTenant) {
    return <section className="text-sm text-muted">Select a business first to configure its WhatsApp agent.</section>;
  }

  if (!aiEnabled) {
    return <section className="text-sm text-muted">Enable AI Chat first. The WhatsApp Agent depends on the same RAG and ordering brain.</section>;
  }

  if (!whatsappEnabled) {
    return <section className="text-sm text-muted">Enable the WhatsApp Agent module from Modules before connecting a WhatsApp number.</section>;
  }

  return (
    <section className="space-y-6">
      <div className="rounded-md border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-brand">Phase 22</p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">WhatsApp Agent Integration</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              Connect the owner&apos;s WhatsApp number so customer questions that were previously handled manually can now be answered by the BizXus AI agent using RAG, catalog data, and draft order planning.
            </p>
          </div>
          <div className={connected ? "rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700" : "rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"}>
            <div className="font-semibold">{connected ? "Connected" : "Not connected"}</div>
            <div className="mt-1">Provider: {settings?.provider || form.provider}</div>
            <div className="mt-1 text-xs">
              {(settings?.provider || form.provider) === "mock"
                ? "Mock mode replies inside this dashboard only; it will not send messages to your real WhatsApp app."
                : "Meta Cloud mode requires a real access token, phone number ID, test recipient, and public HTTPS webhook."}
            </div>
          </div>
        </div>
      </div>

      {notice ? <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {isLoading ? <div className="text-sm text-muted">Loading settings...</div> : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <form onSubmit={handleSave} className="space-y-5 rounded-md border border-line bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-ink">Connection settings</h2>
            <p className="mt-1 text-sm text-muted">Use mock provider for FYP demo. Use Meta Cloud only when real WhatsApp Cloud API credentials are available.</p>
            {form.provider === "mock" ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                Mock mode means: use the simulator below, AI will reply and save WhatsApp conversations in BizXusAI, but no message will arrive on your personal WhatsApp number.
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                Real WhatsApp checklist: Meta Developer App, WhatsApp Cloud API, Phone Number ID, permanent/temporary access token, webhook verify token, ngrok/public HTTPS URL, and approved test recipient number.
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-ink">
              Provider
              <select className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm" value={form.provider} onChange={(event) => updateForm("provider", event.target.value)}>
                <option value="mock">Mock / FYP demo</option>
                <option value="meta_cloud">Meta WhatsApp Cloud API</option>
              </select>
            </label>
            <label className="text-sm font-medium text-ink">
              Business WhatsApp number
              <input className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm" value={form.businessWhatsAppNumber} onChange={(event) => updateForm("businessWhatsAppNumber", event.target.value)} placeholder="+923001234567" required />
            </label>
            <label className="text-sm font-medium text-ink">
              Display name
              <input className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm" value={form.displayName} onChange={(event) => updateForm("displayName", event.target.value)} placeholder={selectedTenant.name} />
            </label>
            <label className="text-sm font-medium text-ink">
              Phone number ID
              <input className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm" value={form.phoneNumberId} onChange={(event) => updateForm("phoneNumberId", event.target.value)} placeholder="Only for Meta Cloud API" />
            </label>
            <label className="text-sm font-medium text-ink">
              API version
              <input className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm" value={form.apiVersion} onChange={(event) => updateForm("apiVersion", event.target.value)} />
            </label>
            <label className="text-sm font-medium text-ink">
              Access token
              <input className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm" value={form.accessToken} onChange={(event) => updateForm("accessToken", event.target.value)} placeholder={settings?.accessTokenMasked || "Only for Meta Cloud API"} type="password" />
            </label>
          </div>

          <label className="block text-sm font-medium text-ink">
            Welcome/fallback message
            <textarea className="mt-2 min-h-24 w-full rounded-md border border-line px-3 py-2 text-sm" value={form.welcomeMessage} onChange={(event) => updateForm("welcomeMessage", event.target.value)} />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.autoReplyEnabled} onChange={(event) => updateForm("autoReplyEnabled", event.target.checked)} />
              Auto-reply with AI agent
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.handoffEnabled} onChange={(event) => updateForm("handoffEnabled", event.target.checked)} />
              Allow human handoff keywords
            </label>
          </div>
          <label className="block text-sm font-medium text-ink">
            Handoff keywords
            <input className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm" value={form.handoffKeywords} onChange={(event) => updateForm("handoffKeywords", event.target.value)} />
          </label>

          <div className="rounded-md bg-surface p-4 text-sm text-muted">
            <div className="font-semibold text-ink">Webhook URL</div>
            <div className="mt-1 break-all">{webhookUrl}</div>
            <div className="mt-3 font-semibold text-ink">Verify token</div>
            <div className="mt-1 break-all">{settings?.webhookVerifyToken || "Save settings to generate tenant verify token."}</div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700" disabled={isSaving} type="submit">
              {isSaving ? "Saving..." : "Save / Connect"}
            </button>
            {connected ? (
              <button className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface" onClick={handleDisconnect} type="button">
                Disconnect
              </button>
            ) : null}
          </div>
        </form>

        <div className="space-y-6">
          <form onSubmit={handleMockInbound} className="space-y-4 rounded-md border border-line bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold text-ink">Mock customer message</h2>
              <p className="mt-1 text-sm text-muted">Simulate a WhatsApp customer asking the agent a question or requesting an order.</p>
            </div>
            <input className="w-full rounded-md border border-line px-3 py-2 text-sm" value={mockForm.customerPhone} onChange={(event) => setMockForm((current) => ({ ...current, customerPhone: event.target.value }))} placeholder="Customer phone" />
            <input className="w-full rounded-md border border-line px-3 py-2 text-sm" value={mockForm.customerName} onChange={(event) => setMockForm((current) => ({ ...current, customerName: event.target.value }))} placeholder="Customer name" />
            <textarea className="min-h-28 w-full rounded-md border border-line px-3 py-2 text-sm" value={mockForm.messageText} onChange={(event) => setMockForm((current) => ({ ...current, messageText: event.target.value }))} />
            <button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700" disabled={!connected || isSimulating} type="submit">
              {isSimulating ? "Processing..." : "Process with AI"}
            </button>
            {lastResult ? (
              <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                <div className="font-semibold">AI reply</div>
                <p className="mt-1 leading-6">{lastResult.reply}</p>
                {lastResult.draftOrder?.items?.length ? <div className="mt-2 text-xs">Draft ready: {lastResult.draftOrder.items.map((item) => `${item.quantity} x ${item.name}`).join(", ")}</div> : null}
              </div>
            ) : null}
          </form>

          <form onSubmit={handleSendTest} className="space-y-4 rounded-md border border-line bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold text-ink">Send test message</h2>
              <p className="mt-1 text-sm text-muted">Mock mode logs this locally. Meta mode sends through WhatsApp Cloud API if credentials are valid.</p>
            </div>
            <input className="w-full rounded-md border border-line px-3 py-2 text-sm" value={testForm.toPhone} onChange={(event) => setTestForm((current) => ({ ...current, toPhone: event.target.value }))} placeholder="Recipient phone" />
            <textarea className="min-h-20 w-full rounded-md border border-line px-3 py-2 text-sm" value={testForm.messageText} onChange={(event) => setTestForm((current) => ({ ...current, messageText: event.target.value }))} />
            <button className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface" disabled={!connected || isSendingTest} type="submit">
              {isSendingTest ? "Sending..." : "Send test"}
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-md border border-line bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Recent WhatsApp conversations</h2>
            <p className="mt-1 text-sm text-muted">These also appear in the AI Chat conversation review screen.</p>
          </div>
          <button className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-surface" onClick={() => loadWorkspace()} type="button">
            Refresh
          </button>
        </div>
        <div className="mt-4 overflow-hidden rounded-md border border-line">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Last intent</th>
                <th className="px-4 py-3">Summary</th>
                <th className="px-4 py-3">Last message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {conversations.length ? (
                conversations.map((conversation) => (
                  <tr key={conversation.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{conversation.externalCustomerName || "WhatsApp Customer"}</div>
                      <div className="text-xs text-muted">{conversation.externalCustomerPhone}</div>
                    </td>
                    <td className="px-4 py-3 text-muted">{conversation.lastIntent || "-"}</td>
                    <td className="px-4 py-3 text-muted">{conversation.summary || "-"}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(conversation.lastMessageAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-4 py-6 text-center text-muted" colSpan="4">
                    No WhatsApp conversations yet. Use the mock simulator to test the flow.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
