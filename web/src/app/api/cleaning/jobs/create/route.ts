/**
 * Retired: cleaning is booked through POST /api/jobs/create, which uses the new
 * rate card and sends cleans to LISTD for a fixed quote before payment.
 */
export async function POST() {
  return Response.json(
    { error: 'Book cleaning through the main booking flow.', code: 'moved' },
    { status: 410 }
  )
}
