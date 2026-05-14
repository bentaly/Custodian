import { createFileRoute } from '@tanstack/react-router'
import { SignIn } from '@clerk/react'

export const Route = createFileRoute('/sign-in')({
  component: SignInPage,
})

function SignInPage() {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <SignIn routing="hash" />
    </div>
  )
}
