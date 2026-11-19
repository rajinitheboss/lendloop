import { SignUp } from "@clerk/nextjs";
import { AuthPage } from "@/components/auth-page";

export default function SignUpPage() {
  return (
    <AuthPage>
      <SignUp />
    </AuthPage>
  );
}
