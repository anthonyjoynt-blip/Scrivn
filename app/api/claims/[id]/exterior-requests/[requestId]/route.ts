import { NextResponse } from "next/server";
import { actOnExteriorRequest, RequestMissingError, RequestStateError } from "@/lib/exteriorRequestsRepo";
import { errorResponse } from "../../../route";

/**
 * One exterior request (0016): PATCH { action: "withdraw" | "applied" } -> { request }.
 *
 * "withdraw" takes it back while it is sent, measured or waiting to be used; "applied" says the tester used it
 * (the claim's own save put it in), so it is not offered again. Both through the member's own session and the
 * definer functions 0016 grants them; asked twice, the second answers as the first. Anything past that is a 409
 * in plain words: "It has been used already."
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  try {
    const { id, requestId } = await params;
    if (!UUID.test(id) || !UUID.test(requestId)) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    const action = body?.action;
    if (action !== "withdraw" && action !== "applied") return NextResponse.json({ error: 'Say "withdraw" or "applied".' }, { status: 400 });
    return NextResponse.json({ request: await actOnExteriorRequest(id.toLowerCase(), requestId.toLowerCase(), action) });
  } catch (err) {
    if (err instanceof RequestMissingError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof RequestStateError) return NextResponse.json({ error: err.message }, { status: 409 });
    return errorResponse(err);
  }
}
