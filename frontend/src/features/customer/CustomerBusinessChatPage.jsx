import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { confirmCustomerDraftTransaction, getCustomerChatState, sendCustomerChatMessage } from "../../services/customerPortalApi.js";
import { formatTransactionSuccess } from "../../utils/transaction.js";

const emptyReply = { tenant: null, conversation: null, messages: [], draftOrder: {} };

export function CustomerBusinessChatPage() {
  const { tenantSlug } = useParams();
  const navigate = useNavigate();
  const [chatState, setChatState] = useState(emptyReply);
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draftQuantities, setDraftQuantities] = useState({});
  const [fulfillmentDraft, setFulfillmentDraft] = useState({ type: "", addressLine1: "", city: "" });

  useEffect(() => {
    async function loadChat() {
      setError("");
      try {
        const data = await getCustomerChatState(tenantSlug);
        setChatState(data);
      } catch (requestError) {
        setError(requestError.response?.data?.detail || "Unable to load customer chat.");
      }
    }

    loadChat();
  }, [tenantSlug]);

  async function submitMessage(event) {
    event.preventDefault();
    if (!messageText.trim()) {
      return;
    }

    setIsSending(true);
    setError("");
    setNotice("");
    try {
      const data = await sendCustomerChatMessage(tenantSlug, { messageText: messageText.trim() });
      setChatState(data);
      setDraftQuantities({});
      setFulfillmentDraft({ type: data.draftOrder?.fulfillmentPreference?.type === "delivery" ? "delivery" : "pickup", addressLine1: "", city: "" });
      setMessageText("");
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to process chat message.");
    } finally {
      setIsSending(false);
    }
  }

  async function confirmDraft() {
    if (!chatState.draftOrder?.items?.length) {
      return;
    }

    setIsConfirming(true);
    setError("");
    setNotice("");
    try {
      const order = await confirmCustomerDraftTransaction(tenantSlug, {
        conversationId: chatState.conversation?.id,
        transactionType: chatState.draftOrder.transactionType || "auto",
        items: chatState.draftOrder.items.map((item) => ({
          itemId: item.itemId,
          quantity: Number(draftQuantities[item.itemId] || item.quantity || 1),
          selectedVariantIndex: item.selectedVariantIndex ?? null,
          selectedVariantName: item.selectedVariantName || "",
          selectedOptions: item.selectedOptions || {},
          variantSku: item.variantSku || "",
        })),
        fulfillment: {
          type: fulfillmentDraft.type || (chatState.draftOrder.fulfillmentPreference?.type === "delivery" ? "delivery" : "pickup"),
          address: (fulfillmentDraft.type || chatState.draftOrder.fulfillmentPreference?.type) === "delivery"
            ? { line1: fulfillmentDraft.addressLine1, city: fulfillmentDraft.city }
            : {},
        },
        notes: "Confirmed from customer AI chat.",
        customFields: {},
      });
      setNotice(formatTransactionSuccess(order));
      navigate(`/customer/orders/${order.id}`);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to confirm draft transaction.");
    } finally {
      setIsConfirming(false);
    }
  }

  const business = chatState.tenant;
  const messages = chatState.messages || [];
  const draftOrder = chatState.draftOrder || {};
  const draftCanConfirm = Boolean(draftOrder.items?.length) && draftOrder.canConfirm !== false;

  function updateDraftQuantity(item, value) {
    const nextQuantity = Math.max(1, Math.min(Number(value || 1), 99));
    setDraftQuantities((current) => ({ ...current, [item.itemId]: nextQuantity }));
  }

  function formatOptions(options = {}) {
    const entries = Object.entries(options || {}).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
    if (!entries.length) return "";
    return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
  }

  if (error && !business) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold text-ink">AI chat unavailable</h1>
        <p className="text-sm text-muted">{error}</p>
      </section>
    );
  }

  if (!business) {
    return <section className="text-sm text-muted">Loading AI chat...</section>;
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <div className="border-b border-line pb-6">
          <Link className="text-sm font-semibold text-brand" to={`/customer/businesses/${tenantSlug}`}>Back to {business.name}</Link>
          <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-brand">Customer AI Ordering</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Chat with {business.name}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
            Ask for an item in English or Roman Urdu. The assistant understands color, size, quantity, budget, delivery intent, and prepares a stock-checked draft order.
          </p>
        </div>

        {notice ? <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div> : null}
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

        <div className="space-y-3 rounded-md border border-line bg-white p-5 shadow-sm">
          {messages.length ? (
            messages.map((message) => (
              <div key={message.id} className={message.sender === "customer" ? "ml-auto max-w-[85%] rounded-md bg-brand px-4 py-3 text-sm text-white" : "max-w-[85%] rounded-md bg-surface px-4 py-3 text-sm text-ink"}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-80">{message.sender}</div>
                <div>{message.messageText}</div>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-line bg-surface p-4 text-sm text-muted">
              Try something like: <span className="font-semibold text-ink">mujhe 2 zinger burgers chahiye</span>
            </div>
          )}
        </div>

        <form className="space-y-3 rounded-md border border-line bg-white p-5 shadow-sm" onSubmit={submitMessage}>
          <label className="block text-sm font-medium text-ink" htmlFor="chatMessage">Your request</label>
          <textarea
            id="chatMessage"
            className="form-input min-h-28"
            placeholder="Example: mujhe 2 burgers chahiye"
            value={messageText}
            onChange={(event) => setMessageText(event.target.value)}
          />
          <button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={isSending}>
            {isSending ? "Sending..." : "Send message"}
          </button>
        </form>
      </div>

      <aside className="space-y-4">
        <div className="rounded-md border border-line bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-wide text-brand">Draft Order</div>
          {draftOrder.items?.length ? (
            <>
              <div className="mt-4 space-y-3">
                {draftOrder.items.map((item) => {
                  const optionsText = formatOptions(item.selectedOptions);
                  const stock = item.stockSnapshot || {};
                  return (
                    <div key={`${draftOrder.conversationId || "draft"}-${item.itemId}-${item.selectedVariantIndex ?? "base"}`} className="rounded-md border border-line p-3">
                      <div className="font-semibold text-ink">{item.name}</div>
                      {item.selectedVariantName ? <div className="mt-1 text-sm text-muted">Variant: {item.selectedVariantName}</div> : null}
                      {optionsText ? <div className="mt-1 text-sm text-muted">Options: {optionsText}</div> : null}
                      <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor={`qty-${item.itemId}`}>Quantity</label>
                      <input
                        id={`qty-${item.itemId}`}
                        className="form-input mt-1"
                        min="1"
                        max="99"
                        type="number"
                        value={draftQuantities[item.itemId] || item.quantity}
                        onChange={(event) => updateDraftQuantity(item, event.target.value)}
                      />
                      <div className="mt-2 text-sm text-muted">Unit price: {item.currency} {item.unitPrice}</div>
                      <div className="mt-1 text-sm text-muted">Line total: {item.currency} {Number((draftQuantities[item.itemId] || item.quantity) * item.unitPrice).toFixed(2)}</div>
                      <div className={stock.available === false ? "mt-2 text-sm font-semibold text-red-600" : "mt-2 text-sm font-semibold text-green-700"}>
                        {stock.tracked ? `Stock: ${stock.availableQuantity ?? 0} available` : "Stock: not tracked / service"}
                      </div>
                    </div>
                  );
                })}
              </div>
              {draftOrder.confirmationIssues?.length ? (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {draftOrder.confirmationIssues.map((issue) => <div key={issue}>{issue}</div>)}
                </div>
              ) : null}
              {draftOrder.requestedAttributes && Object.keys(draftOrder.requestedAttributes).length ? (
                <div className="mt-4 rounded-md bg-surface p-3 text-sm text-muted">
                  Requested attributes: {Object.entries(draftOrder.requestedAttributes).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join("/") : value}`).join(", ")}
                </div>
              ) : null}
              {draftOrder.fulfillmentPreference?.type && draftOrder.fulfillmentPreference.type !== "none" ? (
                <div className="mt-3 rounded-md bg-surface p-3 text-sm text-muted">Preferred fulfillment: {draftOrder.fulfillmentPreference.type}</div>
              ) : null}
              {draftOrder.pricing?.total ? (
                <div className="mt-4 flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink">
                  <span>Estimated total</span>
                  <span>{draftOrder.pricing.currency || "PKR"} {Number(draftOrder.pricing.total).toFixed(2)}</span>
                </div>
              ) : null}
              {draftOrder.suggestedItems?.length ? (
                <div className="mt-4">
                  <div className="text-sm font-semibold text-ink">Suggested matches</div>
                  <div className="mt-2 space-y-2 text-sm text-muted">
                    {draftOrder.suggestedItems.map((item) => (
                      <div key={`suggested-${item.itemId}`} className="flex items-center justify-between rounded-md border border-line px-3 py-2">
                        <span>{item.name}{item.matchedVariant?.name ? ` (${item.matchedVariant.name})` : ""}</span>
                        <span>{item.currency} {item.price}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 rounded-md border border-line bg-surface p-3">
                <div className="text-sm font-semibold text-ink">Fulfillment details</div>
                <select
                  className="form-input mt-2"
                  value={fulfillmentDraft.type || (draftOrder.fulfillmentPreference?.type === "delivery" ? "delivery" : "pickup")}
                  onChange={(event) => setFulfillmentDraft((current) => ({ ...current, type: event.target.value }))}
                >
                  <option value="pickup">Pickup / collect from business</option>
                  <option value="delivery">Delivery</option>
                </select>
                {(fulfillmentDraft.type || draftOrder.fulfillmentPreference?.type) === "delivery" ? (
                  <div className="mt-3 grid gap-2">
                    <input
                      className="form-input"
                      placeholder="Delivery address / area"
                      value={fulfillmentDraft.addressLine1}
                      onChange={(event) => setFulfillmentDraft((current) => ({ ...current, addressLine1: event.target.value }))}
                      required
                    />
                    <input
                      className="form-input"
                      placeholder="City e.g. Attock"
                      value={fulfillmentDraft.city}
                      onChange={(event) => setFulfillmentDraft((current) => ({ ...current, city: event.target.value }))}
                      required
                    />
                  </div>
                ) : null}
              </div>
              <button
                className="mt-4 w-full rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isConfirming || !draftCanConfirm}
                onClick={confirmDraft}
                type="button"
              >
                {!draftCanConfirm ? "Cannot confirm yet" : isConfirming ? "Confirming..." : "Confirm draft order"}
              </button>
            </>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted">No draft yet. Try: “2 black shirts deliver kar do”, “red medium hoodie chahiye”, or “burger under 500 order kar do”.</p>
          )}
        </div>
      </aside>
    </section>
  );
}
