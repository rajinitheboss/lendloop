import { SignIn } from "@clerk/nextjs";
import { AuthPage } from "@/components/auth-page";

/**
 * Sign-in hosted on our own domain, so redirects after sign-in never have
 * to cross to Clerk's account portal and back.
 */
export default function SignInPage() {
  return (
    <AuthPage>
      <SignIn />
    </AuthPage>
  );
}
