export async function login(email: string, password: string) {
  const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ email, password }) })
  const { token } = await r.json()
  localStorage.setItem("authToken", token)
}

export const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken")}` })
