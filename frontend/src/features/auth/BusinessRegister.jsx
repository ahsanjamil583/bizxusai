import { joiResolver } from "@hookform/resolvers/joi";
import Joi from "joi";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext.jsx";
import { getApiErrorMessage } from "../../services/apiError.js";
import { registerBusiness, registerBusinessWithPhone, requestBusinessOtp } from "../../services/authApi.js";
import { AuthPanel } from "./AuthPanel.jsx";

const schema = Joi.object({
  fullName: Joi.string().min(2).required().label("Full name"),
  phone: Joi.string().min(7).required().label("Phone"),
  email: Joi.string().allow("").email({ tlds: false }).label("Email"),
  password: Joi.string().min(6).required().label("Password"),
  otpCode: Joi.string().allow("").min(4).label("OTP code"),
});

export function BusinessRegister() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [authVariant, setAuthVariant] = useState("phoneOtp");
  const [serverError, setServerError] = useState("");
  const [otpStatus, setOtpStatus] = useState("");
  const [otpInfo, setOtpInfo] = useState(null);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const form = useForm({
    resolver: joiResolver(schema),
    defaultValues: { fullName: "", phone: "", email: "", password: "", otpCode: "" },
  });

  async function sendOtp() {
    setServerError("");
    setOtpStatus("");
    const phone = form.getValues("phone");
    if (!phone) {
      setServerError("Enter your phone number first.");
      return;
    }
    setIsSendingOtp(true);
    try {
      const result = await requestBusinessOtp({ phone, purpose: "register", channel: "sms" });
      setOtpInfo(result);
      setOtpStatus(`OTP sent to ${result.maskedPhone || result.phone}.`);
    } catch (error) {
      setServerError(getApiErrorMessage(error, "Could not send OTP."));
    } finally {
      setIsSendingOtp(false);
    }
  }

  async function submit(values) {
    setServerError("");
    try {
      if (authVariant === "phoneOtp" && !otpInfo) {
        setServerError("Send OTP first, then enter the received/demo code.");
        return;
      }
      const payload = {
        fullName: values.fullName,
        phone: values.phone,
        password: values.password,
        ...(values.email ? { email: values.email } : {}),
      };
      const session = authVariant === "phoneOtp"
        ? await registerBusinessWithPhone({ ...payload, code: values.otpCode })
        : await registerBusiness(payload);
      setSession(session);
      navigate("/dashboard/business");
    } catch (error) {
      setServerError(getApiErrorMessage(error, "Registration failed."));
    }
  }

  return (
    <AuthPanel
      title="Create Business Account"
      subtitle="Start with your phone number, verify OTP, and launch a business workspace without forcing email-first onboarding."
      mode="register"
      authVariant={authVariant}
      emailOptional
      register={form.register}
      errors={form.formState.errors}
      isSubmitting={form.formState.isSubmitting}
      serverError={serverError}
      onSubmit={form.handleSubmit(submit)}
      submitLabel="Create account"
      switchLabel="Already registered?"
      switchTo="/login"
      otpInfo={otpInfo}
      otpStatus={otpStatus}
      onSendOtp={sendOtp}
      isSendingOtp={isSendingOtp}
      onToggleAuthVariant={() => setAuthVariant(authVariant === "phoneOtp" ? "password" : "phoneOtp")}
      authVariantToggleLabel={authVariant === "phoneOtp" ? "Use email/password registration instead" : "Use phone OTP registration instead"}
    />
  );
}
