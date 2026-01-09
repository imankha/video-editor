/**
 * Cloudflare Pages Function to handle signup form submissions
 * Stores signups in D1 database
 */

interface Env {
  DB: D1Database
}

interface SignupRequest {
  email: string
  name: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  try {
    const body: SignupRequest = await request.json()
    const { email, name } = body

    // Validate input
    if (!email || !name) {
      return new Response(
        JSON.stringify({ error: 'Email and name are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email address' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Check for duplicate email
    const existing = await env.DB.prepare(
      'SELECT id FROM signups WHERE email = ?'
    ).bind(email).first()

    if (existing) {
      return new Response(
        JSON.stringify({ error: 'Email already registered' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Insert signup
    await env.DB.prepare(
      'INSERT INTO signups (email, name, created_at) VALUES (?, ?, ?)'
    ).bind(email, name, new Date().toISOString()).run()

    return new Response(
      JSON.stringify({ success: true, message: 'Signup successful' }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Signup error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
