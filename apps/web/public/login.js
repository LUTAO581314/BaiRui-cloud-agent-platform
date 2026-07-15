async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || "request_failed"), { status: response.status });
  return body;
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const error = document.querySelector("#form-error");
  error.hidden = true;
  try {
    const result = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
    location.href = ["org_admin", "platform_admin"].includes(result.user.role) && new URLSearchParams(location.search).get("next") === "/admin" ? "/admin" : "/app";
  } catch (requestError) {
    error.textContent = requestError.status === 429 ? "登录尝试过多，请稍后重试" : "邮箱或密码错误";
    error.hidden = false;
  }
});
