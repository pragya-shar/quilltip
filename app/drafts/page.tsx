import { redirect } from 'next/navigation'
export default function DraftsPage() {
  redirect('/write?desk=writing')
}
