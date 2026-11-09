import { redirect } from 'next/navigation'

// Cleaning is one of the services in the main booking wizard.
export default function BookCleanPage() {
  redirect('/book')
}
