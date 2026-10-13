import { db } from "../../../db"
import { hashPassword } from "../../../passwords"

export async function POST(req: Request) {
  const { email, password } = await req.json()
  await db.user.create({ data: { email: String(email), passwordHash: await hashPassword(String(password)), emailVerified: null } })
  return Response.json({ ok: true })
}
