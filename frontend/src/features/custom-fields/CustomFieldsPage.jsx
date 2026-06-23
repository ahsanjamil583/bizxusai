import { joiResolver } from "@hookform/resolvers/joi";
import Joi from "joi";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";

import { DynamicForm } from "../../components/dynamic/DynamicForm.jsx";
import { DynamicTable } from "../../components/dynamic/DynamicTable.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { createCustomField, deleteCustomField, getCustomFields, updateCustomField, validateCustomValues } from "../../services/customFieldApi.js";

const schema = Joi.object({
  moduleCode: Joi.string().valid("customers", "items", "transactions").required(),
  entityType: Joi.string().valid("customer", "item", "transaction").required(),
  key: Joi.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).required().label("Key"),
  label: Joi.string().min(2).required().label("Label"),
  type: Joi.string().valid("text", "number", "date", "boolean", "select", "multi_select", "file", "reference").required(),
  required: Joi.boolean(),
  optionsText: Joi.string().allow(""),
  defaultValueText: Joi.string().allow(""),
  minLength: Joi.number().allow(null),
  maxLength: Joi.number().allow(null),
  minValue: Joi.number().allow(null),
  maxValue: Joi.number().allow(null),
  order: Joi.number().integer().min(1).required(),
  showInTable: Joi.boolean(),
  showInForm: Joi.boolean(),
});

const moduleEntityMap = {
  customers: "customer",
  items: "item",
  transactions: "transaction",
};

export function CustomFieldsPage() {
  const { selectedTenant } = useTenant();
  const [fields, setFields] = useState([]);
  const [filters, setFilters] = useState({ moduleCode: "customers", entityType: "customer" });
  const [previewValues, setPreviewValues] = useState({});
  const [validationResult, setValidationResult] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [serverMessage, setServerMessage] = useState("");
  const [serverError, setServerError] = useState("");

  const form = useForm({
    resolver: joiResolver(schema),
    defaultValues: {
      moduleCode: "customers",
      entityType: "customer",
      key: "",
      label: "",
      type: "text",
      required: false,
      optionsText: "",
      defaultValueText: "",
      minLength: null,
      maxLength: null,
      minValue: null,
      maxValue: null,
      order: 1,
      showInTable: true,
      showInForm: true,
    },
  });

  const watchedModule = form.watch("moduleCode");
  const watchedType = form.watch("type");

  useEffect(() => {
    form.setValue("entityType", moduleEntityMap[watchedModule]);
  }, [watchedModule]);

  useEffect(() => {
    if (selectedTenant?.id) {
      refreshFields();
    }
  }, [selectedTenant?.id, filters.moduleCode, filters.entityType]);

  async function refreshFields() {
    const data = await getCustomFields(selectedTenant.id, filters);
    setFields(data);
  }

  function resetBuilder(moduleCode = filters.moduleCode, entityType = filters.entityType) {
    setEditingField(null);
    form.reset({
      moduleCode,
      entityType,
      key: "",
      label: "",
      type: "text",
      required: false,
      optionsText: "",
      defaultValueText: "",
      minLength: null,
      maxLength: null,
      minValue: null,
      maxValue: null,
      order: 1,
      showInTable: true,
      showInForm: true,
    });
  }

  function parseDefaultValue(type, rawValue) {
    if (rawValue === "") return null;
    if (type === "number") return Number(rawValue);
    if (type === "boolean") return String(rawValue).toLowerCase() === "true";
    if (type === "multi_select") {
      return rawValue.split(",").map((option) => option.trim()).filter(Boolean);
    }
    return rawValue;
  }

  function buildValidation(type, values) {
    const validation = {};
    if (type === "text") {
      if (values.minLength !== null && values.minLength !== "" && !Number.isNaN(values.minLength)) validation.minLength = Number(values.minLength);
      if (values.maxLength !== null && values.maxLength !== "" && !Number.isNaN(values.maxLength)) validation.maxLength = Number(values.maxLength);
    }
    if (type === "number") {
      if (values.minValue !== null && values.minValue !== "" && !Number.isNaN(values.minValue)) validation.min = Number(values.minValue);
      if (values.maxValue !== null && values.maxValue !== "" && !Number.isNaN(values.maxValue)) validation.max = Number(values.maxValue);
    }
    return validation;
  }

  async function submit(values) {
    if (!selectedTenant) return;
    setServerError("");
    setServerMessage("");
    const options = values.optionsText
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean);
    const payload = {
      moduleCode: values.moduleCode,
      entityType: values.entityType,
      key: values.key,
      label: values.label,
      type: values.type,
      required: values.required,
      options,
      defaultValue: parseDefaultValue(values.type, values.defaultValueText),
      validation: buildValidation(values.type, values),
      order: values.order,
      showInTable: values.showInTable,
      showInForm: values.showInForm,
    };

    try {
      if (editingField) {
        await updateCustomField(selectedTenant.id, editingField.id, {
          label: payload.label,
          required: payload.required,
          options: payload.options,
          defaultValue: payload.defaultValue,
          validation: payload.validation,
          order: payload.order,
          showInTable: payload.showInTable,
          showInForm: payload.showInForm,
          isActive: true,
        });
      } else {
        await createCustomField(selectedTenant.id, payload);
      }
      resetBuilder(values.moduleCode, values.entityType);
      form.setValue("order", values.order + (editingField ? 0 : 1));
      setFilters({ moduleCode: values.moduleCode, entityType: values.entityType });
      await refreshFields();
      setServerMessage(editingField ? "Custom field updated." : "Custom field created.");
    } catch (error) {
      setServerError(error.response?.data?.detail || "Unable to save custom field.");
    }
  }

  function editField(field) {
    setEditingField(field);
    form.reset({
      moduleCode: field.moduleCode,
      entityType: field.entityType,
      key: field.key,
      label: field.label,
      type: field.type,
      required: Boolean(field.required),
      optionsText: (field.options || []).join(", "),
      defaultValueText: Array.isArray(field.defaultValue) ? field.defaultValue.join(", ") : field.defaultValue ?? "",
      minLength: field.validation?.minLength ?? null,
      maxLength: field.validation?.maxLength ?? null,
      minValue: field.validation?.min ?? null,
      maxValue: field.validation?.max ?? null,
      order: field.order || 1,
      showInTable: Boolean(field.showInTable),
      showInForm: Boolean(field.showInForm),
    });
  }

  async function disableField(fieldId) {
    await deleteCustomField(selectedTenant.id, fieldId);
    await refreshFields();
  }

  async function validatePreview() {
    const result = await validateCustomValues(selectedTenant.id, {
      moduleCode: filters.moduleCode,
      entityType: filters.entityType,
      values: previewValues,
    });
    setValidationResult(result);
  }

  const activeFields = useMemo(() => fields.filter((field) => field.isActive), [fields]);
  const sampleRows = useMemo(() => [validationResult?.values || previewValues], [validationResult, previewValues]);

  if (!selectedTenant) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold text-ink">Custom Fields</h1>
        <p className="text-sm text-muted">Create a business before defining custom fields.</p>
        <Link className="inline-flex rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white" to="/dashboard/business">
          Create Business
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="border-b border-line pb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">Dynamic Schema</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Custom Fields</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Define tenant-specific fields for customers, items, and transactions without changing database schemas.
        </p>
      </div>

      {serverMessage ? <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{serverMessage}</div> : null}
      {serverError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <form className="space-y-4 rounded-md border border-line bg-white p-5 shadow-sm" onSubmit={form.handleSubmit(submit)}>
          <h2 className="text-lg font-semibold text-ink">Field Builder</h2>
          <Field label="Module">
            <select className="form-input" disabled={Boolean(editingField)} {...form.register("moduleCode")}>
              <option value="customers">Customers</option>
              <option value="items">Items</option>
              <option value="transactions">Transactions</option>
            </select>
          </Field>
          <Field label="Entity type">
            <input className="form-input bg-surface" readOnly {...form.register("entityType")} />
          </Field>
          <Field label="Key" error={form.formState.errors.key?.message}>
            <input className="form-input" disabled={Boolean(editingField)} placeholder="loyalty_level" {...form.register("key")} />
          </Field>
          <Field label="Label" error={form.formState.errors.label?.message}>
            <input className="form-input" placeholder="Loyalty Level" {...form.register("label")} />
          </Field>
          <Field label="Type">
            <select className="form-input" disabled={Boolean(editingField)} {...form.register("type")}>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="boolean">Boolean</option>
              <option value="select">Select</option>
              <option value="multi_select">Multi select</option>
              <option value="file">File placeholder</option>
              <option value="reference">Reference placeholder</option>
            </select>
          </Field>
          {watchedType === "select" || watchedType === "multi_select" ? (
            <Field label="Options">
              <input className="form-input" placeholder="Gold, Silver, Bronze" {...form.register("optionsText")} />
            </Field>
          ) : null}
          <Field label="Default value">
            <input
              className="form-input"
              placeholder={watchedType === "boolean" ? "true or false" : watchedType === "multi_select" ? "Gold, Bronze" : "Optional default"}
              {...form.register("defaultValueText")}
            />
          </Field>
          {watchedType === "text" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Min length">
                <input className="form-input" type="number" min="0" {...form.register("minLength", { valueAsNumber: true })} />
              </Field>
              <Field label="Max length">
                <input className="form-input" type="number" min="0" {...form.register("maxLength", { valueAsNumber: true })} />
              </Field>
            </div>
          ) : null}
          {watchedType === "number" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Min value">
                <input className="form-input" type="number" step="0.01" {...form.register("minValue", { valueAsNumber: true })} />
              </Field>
              <Field label="Max value">
                <input className="form-input" type="number" step="0.01" {...form.register("maxValue", { valueAsNumber: true })} />
              </Field>
            </div>
          ) : null}
          <Field label="Order">
            <input className="form-input" type="number" min="1" {...form.register("order", { valueAsNumber: true })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Check label="Required" register={form.register("required")} />
            <Check label="In form" register={form.register("showInForm")} />
            <Check label="In table" register={form.register("showInTable")} />
          </div>
          <div className="flex gap-2">
            <button className="flex-1 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving..." : editingField ? "Update Field" : "Create Field"}
            </button>
            {editingField ? (
              <button type="button" className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface" onClick={() => resetBuilder()}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <div className="space-y-5">
          <div className="rounded-md border border-line bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-ink">Field Definitions</h2>
                <p className="mt-1 text-sm text-muted">Active and disabled fields for the selected entity.</p>
              </div>
              <div className="flex gap-2">
                <select className="form-input" value={filters.moduleCode} onChange={(event) => setFilters({ moduleCode: event.target.value, entityType: moduleEntityMap[event.target.value] })}>
                  <option value="customers">Customers</option>
                  <option value="items">Items</option>
                  <option value="transactions">Transactions</option>
                </select>
              </div>
            </div>
            <div className="mt-4 divide-y divide-line rounded-md border border-line">
              {fields.length ? fields.map((field) => (
                <div key={field.id} className="flex items-center justify-between gap-4 p-3">
                  <div>
                    <div className="font-semibold text-ink">{field.label}</div>
                    <div className="text-xs text-muted">{field.key} / {field.type} / {field.isActive ? "active" : "disabled"}</div>
                  </div>
                  <div className="flex gap-2">
                    {field.isActive ? (
                      <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface" onClick={() => editField(field)}>
                        Edit
                      </button>
                    ) : null}
                    {field.isActive ? (
                      <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface" onClick={() => disableField(field.id)}>
                        Disable
                      </button>
                    ) : null}
                  </div>
                </div>
              )) : <div className="p-4 text-sm text-muted">No fields yet.</div>}
            </div>
          </div>

          <div className="rounded-md border border-line bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">Form Preview</h2>
                <p className="mt-1 text-sm text-muted">Reusable dynamic form with backend validation.</p>
              </div>
              <button type="button" className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white" onClick={validatePreview}>
                Validate
              </button>
            </div>
            <DynamicForm fields={activeFields} values={previewValues} onChange={setPreviewValues} errors={validationResult?.errors || []} />
            {validationResult ? (
              <div className={validationResult.valid ? "mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700" : "mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"}>
                {validationResult.valid ? "Preview values are valid." : "Preview has validation errors."}
              </div>
            ) : null}
          </div>

          <div className="rounded-md border border-line bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-ink">Table Preview</h2>
            <DynamicTable fields={activeFields} rows={sampleRows} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

function Check({ label, register }) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-muted">
      <input type="checkbox" {...register} />
      {label}
    </label>
  );
}
