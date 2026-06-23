import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { createPublicOrder, getPublicChatState, sendPublicChatMessage } from "../../services/publicWebsiteApi.js";
import { buildPublicSiteModel, PublicLoadingState, PublicUnavailableState, PublicWebsiteFrame } from "./publicWebsiteShared.jsx";

const emptyReply = { tenant: null, conversation: null, messages: [], draftOrder: {} };

export function PublicBusinessChatPage() {
  const { tenantSlug } = useParams();
  const storageKey = useMemo(() => `bizxus_public_chat_${tenantSlug}`, [tenantSlug]);
  const [chatState, setChatState] = useState(emptyReply);
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [checkout, setCheckout] = useState({ customerName: "", customerPhone: "", customerEmail: "", fulfillmentType: "", addressLine1: "", city: "" });

  useEffect(() => {
    async function loadChat() {
      setError("");
      try {
        const conversationId = localStorage.getItem(storageKey);
        const data = await getPublicChatState(tenantSlug, conversationId);
        if (data.conversation?.id) {
          localStorage.setItem(storageKey, data.conversation.id);
        }
        setChatState(data);
      } catch (requestError) {
        setError(requestError.response?.data?.detail || "Unable to load public AI chat.");
      }
    }

    loadChat();
  }, [storageKey, tenantSlug]);

  async function submitMessage(event) {
    event.preventDefault();
    if (!messageText.trim()) {
      return;
    }
    setIsSending(true);
    setError("");
    setNotice("");
    try {
      const data = await sendPublicChatMessage(tenantSlug, {
        messageText: messageText.trim(),
        conversationId: chatState.conversation?.id || localStorage.getItem(storageKey),
      });
      if (data.conversation?.id) {
        localStorage.setItem(storageKey, data.conversation.id);
      }
      setChatState(data);
      setMessageText("");
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to process public AI message.");
    } finally {
      setIsSending(false);
    }
  }

  async function confirmPublicDraft(event) {
    event.preventDefault();
    if (!chatState.draftOrder?.items?.length || chatState.draftOrder.canConfirm === false) {
      return;
    }
    setIsConfirming(true);
    setError("");
    setNotice("");
    try {
      const order = await createPublicOrder(tenantSlug, {
        customerName: checkout.customerName.trim(),
        customerPhone: checkout.customerPhone.trim(),
        customerEmail: checkout.customerEmail.trim(),
        conversationId: chatState.conversation?.id || localStorage.getItem(storageKey),
        transactionType: chatState.draftOrder.transactionType || "auto",
        items: chatState.draftOrder.items.map((item) => ({
          itemId: item.itemId,
          quantity: Number(item.quantity || 1),
          selectedVariantIndex: item.selectedVariantIndex ?? null,
          selectedVariantName: item.selectedVariantName || "",
          selectedOptions: item.selectedOptions || {},
          variantSku: item.variantSku || "",
        })),
        fulfillment: {
          type: checkout.fulfillmentType || (chatState.draftOrder.fulfillmentPreference?.type === "delivery" ? "delivery" : "pickup"),
          address: (checkout.fulfillmentType || chatState.draftOrder.fulfillmentPreference?.type) === "delivery"
            ? { line1: checkout.addressLine1, city: checkout.city }
            : {},
        },
        notes: "Confirmed from public AI chat.",
        customFields: {},
      });
      setNotice(`Order ${order.transactionNumber || order.id} created successfully. The business owner has been notified.`);
      const refreshed = await getPublicChatState(tenantSlug, chatState.conversation?.id || localStorage.getItem(storageKey));
      setChatState(refreshed);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to confirm public draft order.");
    } finally {
      setIsConfirming(false);
    }
  }

  function formatOptions(options = {}) {
    const entries = Object.entries(options || {}).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
    if (!entries.length) return "";
    return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
  }

  const business = chatState.tenant;
  const messages = chatState.messages || [];
  const draftOrder = chatState.draftOrder || {};

  if (error && !business) {
    return <PublicUnavailableState title="Public AI chat unavailable" error={error} />;
  }

  if (!business) {
    return <PublicLoadingState label="Loading public AI chat..." />;
  }

  const siteModel = buildPublicSiteModel(business, draftOrder.items || []);

  return (
    <PublicWebsiteFrame business={business} currentPage="chat" siteModel={siteModel}>
      <section className="mx-auto grid max-w-6xl gap-6 px-5 py-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <div className="rounded-[28px] border border-black/5 bg-white/92 p-6 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: siteModel.theme.accent }}>Public AI Chat</p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Ask {business.name}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              Ask about products, services, prices, and availability in English or Roman Urdu. The assistant can also suggest a draft order.
            </p>
          </div>

          {notice ? <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div> : null}
          {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <div className="space-y-3 rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
            {messages.length ? (
              messages.map((message) => (
                <div key={message.id} className={message.sender === "customer" ? "ml-auto max-w-[85%] rounded-2xl bg-brand px-4 py-3 text-sm text-white" : "max-w-[85%] rounded-2xl bg-slate-100 px-4 py-3 text-sm text-ink"}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-80">{message.sender}</div>
                  <div>{message.messageText}</div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-line bg-surface p-4 text-sm text-muted">
                Try asking: <span className="font-semibold text-ink">Aap ke paas kaun se burgers hain?</span>
              </div>
            )}
          </div>

          <form className="space-y-3 rounded-[28px] border border-black/5 bg-white p-5 shadow-sm" onSubmit={submitMessage}>
            <label className="block text-sm font-medium text-ink" htmlFor="publicChatMessage">Ask a question</label>
            <textarea
              id="publicChatMessage"
              className="form-input min-h-28"
              placeholder="Example: spicy burgers available hain?"
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
            />
            <button className="rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={isSending}>
              {isSending ? "Sending..." : "Send message"}
            </button>
          </form>
        </div>

        <aside className="space-y-4">
          <div className="rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: siteModel.theme.accent }}>Suggested Draft</div>
            {draftOrder.items?.length ? (
              <div className="mt-4 space-y-3">
                {draftOrder.items.map((item) => {
                  const optionsText = formatOptions(item.selectedOptions);
                  const stock = item.stockSnapshot || {};
                  return (
                    <div key={`${draftOrder.tenantId || "draft"}-${item.itemId}-${item.selectedVariantIndex ?? "base"}`} className="rounded-2xl border border-black/5 p-3">
                      <div className="font-semibold text-ink">{item.name}</div>
                      {item.selectedVariantName ? <div className="mt-1 text-sm text-muted">Variant: {item.selectedVariantName}</div> : null}
                      {optionsText ? <div className="mt-1 text-sm text-muted">Options: {optionsText}</div> : null}
                      <div className="mt-1 text-sm text-muted">Quantity: {item.quantity}</div>
                      <div className="mt-1 text-sm text-muted">{item.currency} {item.unitPrice}</div>
                      <div className={stock.available === false ? "mt-2 text-sm font-semibold text-red-600" : "mt-2 text-sm font-semibold text-green-700"}>
                        {stock.tracked ? `Stock: ${stock.availableQuantity ?? 0} available` : "Stock: not tracked / service"}
                      </div>
                    </div>
                  );
                })}
                {draftOrder.confirmationIssues?.length ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {draftOrder.confirmationIssues.map((issue) => <div key={issue}>{issue}</div>)}
                  </div>
                ) : null}
                {draftOrder.pricing?.total ? (
                  <div className="flex items-center justify-between rounded-2xl border border-black/5 px-3 py-2 text-sm font-semibold text-ink">
                    <span>Estimated total</span>
                    <span>{draftOrder.pricing.currency || "PKR"} {Number(draftOrder.pricing.total).toFixed(2)}</span>
                  </div>
                ) : null}
                {draftOrder.canConfirm === false ? (
                  <div className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">This draft needs a lower quantity or another option before it can be confirmed.</div>
                ) : (
                  <form className="space-y-3 rounded-2xl bg-slate-50 p-3" onSubmit={confirmPublicDraft}>
                    <div className="text-sm font-semibold text-ink">Confirm as guest</div>
                    <input className="form-input" placeholder="Your name" value={checkout.customerName} onChange={(event) => setCheckout((current) => ({ ...current, customerName: event.target.value }))} required />
                    <input className="form-input" placeholder="Phone / WhatsApp number" value={checkout.customerPhone} onChange={(event) => setCheckout((current) => ({ ...current, customerPhone: event.target.value }))} required />
                    <input className="form-input" placeholder="Email optional" value={checkout.customerEmail} onChange={(event) => setCheckout((current) => ({ ...current, customerEmail: event.target.value }))} />
                    <select className="form-input" value={checkout.fulfillmentType || (draftOrder.fulfillmentPreference?.type === "delivery" ? "delivery" : "pickup")} onChange={(event) => setCheckout((current) => ({ ...current, fulfillmentType: event.target.value }))}>
                      <option value="pickup">Pickup / collect from business</option>
                      <option value="delivery">Delivery</option>
                    </select>
                    {(checkout.fulfillmentType || draftOrder.fulfillmentPreference?.type) === "delivery" ? (
                      <div className="space-y-2">
                        <input className="form-input" placeholder="Delivery address / area" value={checkout.addressLine1} onChange={(event) => setCheckout((current) => ({ ...current, addressLine1: event.target.value }))} required />
                        <input className="form-input" placeholder="City e.g. Attock" value={checkout.city} onChange={(event) => setCheckout((current) => ({ ...current, city: event.target.value }))} required />
                      </div>
                    ) : null}
                    <button className="w-full rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={isConfirming}>
                      {isConfirming ? "Confirming..." : "Confirm draft order"}
                    </button>
                  </form>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted">No draft suggestion yet. Try: “black medium shirt chahiye” or “2 burgers deliver kar do”.</p>
            )}
          </div>
        </aside>
      </section>
    </PublicWebsiteFrame>
  );
}
