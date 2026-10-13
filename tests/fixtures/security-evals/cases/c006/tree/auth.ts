import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import { db } from "./db"
import { checkPassword } from "./passwords"

export const { handlers, auth } = NextAuth({
  providers: [
    Google({ allowDangerousEmailAccountLinking: true }),
    Credentials({
      async authorize(creds) {
        const user = await db.user.findUnique({ where: { email: String(creds.email) } })
        if (!user || !(await checkPassword(user, String(creds.password)))) return null
        return user
      },
    }),
  ],
})
