import { joiResolver } from "@hookform/resolvers/joi";
import Joi from "joi";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext.jsx";
import { getApiErrorMessage } from "../../services/apiError.js";
import { loginBusiness, loginBusinessWithPhone, requestBusinessOtp } from "../../services/authApi.js";
import { getMyTenants } from "../../services/tenantApi.js";
import { AuthPanel } from "./AuthPanel.jsx";

const schema = Joi.object({
  email: Joi.string().allow("").email({ tlds: false }).label("Email"),
  phone: Joi.string().allow("").min(7).label("Phone"),
  otpCode: Joi.string().allow("").min(4).label("OTP code"),
  password: Joi.string().allow("").label("Password"),
});

export function BusinessLogin() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [authVariant, setAuthVariant] = useState("phoneOtp");
  const [serverError, setServerError] = useState("");
  const [otpStatus, setOtpStatus] = useState("");
  const [otpInfo, setOtpInfo] = useState(null);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const form = useForm({ resolver: joiResolver(schema), defaultValues: { email: "", phone: "", otpCode: "", password: "" } });

  async function goAfterLogin(session) {
    setSession(session);
    if (session.user.globalRole === "platform_admin") {
      navigate("/admin");
      return;
    }
    const tenants = await getMyTenants().catch(() => []);
    navigate(tenants.length ? "/dashboard" : "/dashboard/business");
  }

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
      const result = await requestBusinessOtp({ phone, purpose: "login", channel: "sms" });
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
      if (authVariant === "phoneOtp") {
        if (!otpInfo) {
          setServerError("Send OTP first, then enter the received/demo code.");
          return;
        }
        if (!values.phone || !values.otpCode) {
          setServerError("Enter phone number and OTP code.");
          return;
        }
        const session = await loginBusinessWithPhone({ phone: values.phone, code: values.otpCode });
        await goAfterLogin(session);
        return;
      }
      if (!values.email || !values.password) {
        setServerError("Enter email and password.");
        return;
      }
      const session = await loginBusiness({ email: values.email, password: values.password });
      await goAfterLogin(session);
    } catch (error) {
      setServerError(getApiErrorMessage(error, "Login failed."));
    }
  }

  return (
    <AuthPanel
      title="Business Login"
      subtitle={authVariant === "phoneOtp" ? "Sign in with your business phone number and OTP. Email/password login is still available for admins and older accounts." : "Access your BizXusAI business workspace with email and password."}
      mode="login"
      authVariant={authVariant}
      register={form.register}
      errors={form.formState.errors}
      isSubmitting={form.formState.isSubmitting}
      serverError={serverError}
      onSubmit={form.handleSubmit(submit)}
      submitLabel={authVariant === "phoneOtp" ? "Sign in with OTP" : "Sign in"}
      switchLabel="Need a business account?"
      switchTo="/register"
      otpInfo={otpInfo}
      otpStatus={otpStatus}
      onSendOtp={sendOtp}
      isSendingOtp={isSendingOtp}
      onToggleAuthVariant={() => setAuthVariant(authVariant === "phoneOtp" ? "password" : "phoneOtp")}
      authVariantToggleLabel={authVariant === "phoneOtp" ? "Use email + password instead" : "Use phone OTP instead"}
      passwordResetTo="/forgot-password"
    />
  );
}
