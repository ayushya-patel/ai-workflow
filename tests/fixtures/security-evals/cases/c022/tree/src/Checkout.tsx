"use client"
import { config } from "./config"

export function Checkout() {
  return <button onClick={() => fetch("https://api.stripe.com/v1/payment_intents", { headers: { Authorization: `Bearer ${config.stripeKey}` } })}>Pay</button>
}
