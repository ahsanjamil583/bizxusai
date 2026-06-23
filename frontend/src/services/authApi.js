import { apiClient } from "./apiClient.js";

export async function registerBusiness(payload) {
  const response = await apiClient.post("/auth/register", payload);
  return response.data.data;
}

export async function registerBusinessWithPhone(payload) {
  const response = await apiClient.post("/auth/register/phone", payload);
  return response.data.data;
}

export async function loginBusiness(payload) {
  const response = await apiClient.post("/auth/login", payload);
  return response.data.data;
}

export async function loginBusinessWithPhone(payload) {
  const response = await apiClient.post("/auth/login/phone", payload);
  return response.data.data;
}

export async function requestBusinessOtp(payload) {
  const response = await apiClient.post("/auth/otp/request", payload);
  return response.data.data;
}

export async function verifyBusinessOtp(payload) {
  const response = await apiClient.post("/auth/otp/verify", payload);
  return response.data.data;
}

export async function requestBusinessPasswordResetOtp(payload) {
  const response = await apiClient.post("/auth/password/phone/request", payload);
  return response.data.data;
}

export async function resetBusinessPasswordWithOtp(payload) {
  const response = await apiClient.post("/auth/password/phone/reset", payload);
  return response.data.data;
}

export async function getBusinessMe() {
  const response = await apiClient.get("/auth/me");
  return response.data.data;
}

export async function refreshBusinessAuth(refreshToken) {
  const response = await apiClient.post("/auth/refresh", { refreshToken });
  return response.data.data;
}

export async function logoutBusiness() {
  const response = await apiClient.post("/auth/logout");
  return response.data;
}
