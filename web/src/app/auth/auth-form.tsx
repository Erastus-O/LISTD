'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ArrowRight,
  Building2,
  Check,
  ClipboardCheck,
  Loader2,
  Mail,
  Sparkles,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AUTH_PRIMARY_BUTTON,
  AuthHeading,
  IconInput,
  PasswordInput,
  PasswordStrength,
} from '@/components/auth/auth-ui'
import { createClient } from '@/lib/supabase/client'
import { PRIVACY_POLICY_VERSION } from '@/lib/legal/policy'
import { PRO_SERVICES, isProServiceRole, type ProServiceRole } from '@/lib/listd/pro-services'
import { cn } from '@/lib/utils'
import { ForgotPasswordForm } from './forgot-password-form'

const signInSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

const signUpSchema = z
  .object({
    fullName: z.string().min(2, 'Name must be at least 2 characters').max(100),
    email: z.string().email('Please enter a valid email address').max(255),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type SignInFormData = z.infer<typeof signInSchema>
type SignUpFormData = z.infer<typeof signUpSchema>

type Role = 'client' | 'pro'

const ROLES: Array<{
  value: Role
  icon: LucideIcon
  label: string
  hint: string
}> = [
  { value: 'client', icon: Building2, label: 'Client', hint: 'Agent or landlord' },
  { value: 'pro', icon: ClipboardCheck, label: 'Pro', hint: 'Inspections, cleaning or repairs' },
]

const SERVICE_ICON: Record<ProServiceRole, LucideIcon> = { clerk: ClipboardCheck, cleaner: Sparkles, trades: Wrench }

export function AuthForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') === 'signup' ? 'signup' : 'signin'
  const redirectParam = searchParams.get('redirect')

  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>(initialTab)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  // Old links (?role=clerk|cleaner|trades) open the Pro sign-up with that service ticked.
  const roleParam = searchParams.get('role')
  const [selectedRole, setSelectedRole] = useState<Role | null>(
    roleParam === 'client' ? 'client' : roleParam === 'pro' || isProServiceRole(roleParam) ? 'pro' : null
  )
  const [services, setServices] = useState<ProServiceRole[]>(isProServiceRole(roleParam) ? [roleParam] : [])
  const [roleError, setRoleError] = useState(false)
  const [servicesError, setServicesError] = useState(false)
  const [consentChecked, setConsentChecked] = useState(false)
  const [consentError, setConsentError] = useState(false)

  const signInForm = useForm<SignInFormData>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })

  const signUpForm = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' },
  })
  const signUpPassword = useWatch({
    control: signUpForm.control,
    name: 'password',
  })

  async function handleSignIn(data: SignInFormData) {
    setIsLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })
    setIsLoading(false)

    if (error) {
      toast.error('Sign in failed', {
        description:
          error.message === 'Invalid login credentials'
            ? 'Invalid email or password. Please try again.'
            : error.message,
      })
      return
    }

    const dest = redirectParam
      ? `/post-signin?redirect=${encodeURIComponent(redirectParam)}`
      : '/post-signin'
    router.push(dest)
    router.refresh()
  }

  async function handleSignUp(data: SignUpFormData) {
    if (!selectedRole) {
      setRoleError(true)
      return
    }
    setRoleError(false)
    if (selectedRole === 'pro' && services.length === 0) {
      setServicesError(true)
      return
    }
    setServicesError(false)
    if (!consentChecked) {
      setConsentError(true)
      return
    }
    setConsentError(false)
    setIsLoading(true)

    const supabase = createClient()
    // Stamp the consent at the moment the user agrees (signup), not at the
    // later server bootstrap, so the recorded date is accurate even when
    // email confirmation delays profile creation.
    const consentAt = new Date().toISOString()
    const { data: signUpData, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.fullName,
          role: selectedRole,
          ...(selectedRole === 'pro' ? { services } : {}),
          privacy_policy_version: PRIVACY_POLICY_VERSION,
          privacy_consent_at: consentAt,
        },
      },
    })
    setIsLoading(false)

    if (error) {
      const message = error.message.includes('already registered')
        ? 'An account with this email already exists. Please sign in instead.'
        : error.message
      toast.error('Sign up failed', { description: message })
      return
    }

    // Email-confirmation case: Supabase returns user but session=null until
    // the user clicks the confirmation link. Stay on the auth page and tell
    // them to check their inbox. Profile bootstrap runs server-side at
    // /post-signin once the email is confirmed (see lib/onboarding.ts).
    if (!signUpData.session) {
      toast.success('Almost there!', {
        description:
          "We've sent a confirmation link to your email. Click it to finish setting up your account.",
      })
      // We stay on this page, so clear the entered details rather than
      // leaving name / email / password sitting in the form.
      signUpForm.reset()
      setSelectedRole(null)
      setServices([])
      setConsentChecked(false)
      return
    }

    // Email-confirmation off: session is live. /post-signin will call
    // bootstrapUser() server-side using user_metadata, then forward to
    // /onboarding. Avoids racing the supabase-ssr cookie sync.
    toast.success('Account created!', {
      description: "Welcome to LISTD. Let's set up your profile.",
    })

    const dest = redirectParam
      ? `/post-signin?redirect=${encodeURIComponent(redirectParam)}`
      : '/post-signin'
    router.push(dest)
    router.refresh()
  }

  if (showForgotPassword) {
    return <ForgotPasswordForm onBack={() => setShowForgotPassword(false)} />
  }

  const isSignUp = activeTab === 'signup'

  return (
    <div className="animate-fade-in">
      <AuthHeading
        title={isSignUp ? 'Create your account' : 'Sign in'}
      >
        {isSignUp
          ? 'Book, deliver and track property services in one place.'
          : 'Welcome back to LISTD.'}
      </AuthHeading>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'signin' | 'signup')}
        className="w-full gap-6"
      >
        <TabsList className="grid h-12! w-full grid-cols-2 rounded-xl bg-muted/70 p-1">
          <TabsTrigger
            value="signin"
            className="rounded-lg text-sm font-semibold data-[state=active]:shadow-sm"
          >
            Sign in
          </TabsTrigger>
          <TabsTrigger
            value="signup"
            className="rounded-lg text-sm font-semibold data-[state=active]:shadow-sm"
          >
            Create account
          </TabsTrigger>
        </TabsList>

        <TabsContent value="signin">
          <Form {...signInForm}>
            <form
              onSubmit={signInForm.handleSubmit(handleSignIn)}
              className="space-y-5"
            >
              <FormField
                control={signInForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <IconInput
                        icon={Mail}
                        type="email"
                        autoComplete="email"
                        placeholder="you@company.co.uk"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={signInForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Password</FormLabel>
                      <button
                        type="button"
                        onClick={() => setShowForgotPassword(true)}
                        className="text-xs font-medium text-primary hover:underline underline-offset-4"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <FormControl>
                      <PasswordInput
                        autoComplete="current-password"
                        placeholder="Your password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className={AUTH_PRIMARY_BUTTON}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </>
                )}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                New to LISTD?{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('signup')}
                  className="font-semibold text-foreground hover:text-primary"
                >
                  Create an account
                </button>
              </p>
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="signup">
          <Form {...signUpForm}>
            <form
              onSubmit={signUpForm.handleSubmit(handleSignUp)}
              className="space-y-5"
            >
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium text-foreground">
                  I am a...
                </legend>
                <div className="grid grid-cols-2 gap-2.5">
                  {ROLES.map(({ value, icon: Icon, label, hint }) => {
                    const selected = selectedRole === value
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedRole(value)
                          setRoleError(false)
                        }}
                        className={cn(
                          'relative flex flex-col items-center gap-1.5 rounded-xl border px-2 py-4 text-center transition-all',
                          selected
                            ? 'border-primary bg-primary/[0.06] ring-4 ring-primary/10'
                            : 'border-border hover:border-primary/40 hover:bg-muted/40'
                        )}
                      >
                        {selected && (
                          <span className="absolute top-2 right-2 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                          </span>
                        )}
                        <span
                          className={cn(
                            'grid h-10 w-10 place-items-center rounded-xl transition-colors',
                            selected
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          <Icon className="h-5 w-5" aria-hidden />
                        </span>
                        <span className="text-sm font-semibold">{label}</span>
                        <span className="text-[11px] leading-tight text-muted-foreground">
                          {hint}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {roleError && (
                  <p className="text-sm text-destructive">
                    Please select your role
                  </p>
                )}
              </fieldset>

              {selectedRole === 'pro' && (
                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-medium text-foreground">
                    Services I offer (pick any)
                  </legend>
                  <div className="grid gap-2">
                    {PRO_SERVICES.map(({ role, label, hint }) => {
                      const Icon = SERVICE_ICON[role]
                      const on = services.includes(role)
                      return (
                        <label
                          key={role}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                            on ? 'border-primary bg-primary/[0.06]' : 'border-border hover:bg-muted/40'
                          )}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={on}
                            onChange={() => {
                              setServices((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
                              setServicesError(false)
                            }}
                          />
                          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                          <span className="grid">
                            <span className="text-sm font-semibold">{label}</span>
                            <span className="text-[11px] leading-tight text-muted-foreground">{hint}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  {servicesError && <p className="text-sm text-destructive">Pick at least one service</p>}
                </fieldset>
              )}

              <FormField
                control={signUpForm.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <IconInput
                        icon={User}
                        autoComplete="name"
                        placeholder="Jane Smith"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={signUpForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <IconInput
                        icon={Mail}
                        type="email"
                        autoComplete="email"
                        placeholder="you@company.co.uk"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={signUpForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                        {...field}
                      />
                    </FormControl>
                    <PasswordStrength value={signUpPassword} />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={signUpForm.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        autoComplete="new-password"
                        placeholder="Repeat your password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-1">
                <label className="flex items-start gap-3 rounded-xl border border-border/80 bg-muted/30 p-3.5 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => {
                      setConsentChecked(e.target.checked)
                      if (e.target.checked) setConsentError(false)
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                    aria-invalid={consentError}
                  />
                  <span>
                    I agree to the{' '}
                    <Link
                      href="/privacy"
                      target="_blank"
                      className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
                    >
                      Privacy Policy
                    </Link>{' '}
                    and{' '}
                    <Link
                      href="/terms"
                      target="_blank"
                      className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
                    >
                      Terms of Service
                    </Link>
                    .
                  </span>
                </label>
                {consentError && (
                  <p className="text-sm text-destructive">
                    Please accept the Privacy Policy and Terms to continue.
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className={AUTH_PRIMARY_BUTTON}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Creating account...
                  </>
                ) : (
                  <>
                    Create account
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </>
                )}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('signin')}
                  className="font-semibold text-foreground hover:text-primary"
                >
                  Sign in
                </button>
              </p>
            </form>
          </Form>
        </TabsContent>
      </Tabs>
    </div>
  )
}
