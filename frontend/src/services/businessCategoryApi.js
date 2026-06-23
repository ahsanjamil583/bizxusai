import { apiClient } from "./apiClient.js";

export async function getPublicBusinessCategories() {
  const response = await apiClient.get("/public/business-categories");
  return response.data.data;
}

export async function getAdminBusinessCategories() {
  const response = await apiClient.get("/admin/business-categories");
  return response.data.data;
}

export async function createAdminBusinessCategory(payload) {
  const response = await apiClient.post("/admin/business-categories", payload);
  return response.data.data;
}

export async function updateAdminBusinessCategory(categoryId, payload) {
  const response = await apiClient.put(`/admin/business-categories/${categoryId}`, payload);
  return response.data.data;
}

export async function deleteAdminBusinessCategory(categoryId) {
  const response = await apiClient.delete(`/admin/business-categories/${categoryId}`);
  return response.data.data;
}
