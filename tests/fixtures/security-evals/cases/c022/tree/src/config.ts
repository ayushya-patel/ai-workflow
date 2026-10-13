export const config = {
  apiBase: process.env.NEXT_PUBLIC_API_BASE ?? "https://api.example.com",
  stripeKey: process.env.NEXT_PUBLIC_STRIPE_KEY ?? "{{SECRET:stripe}}",
}
