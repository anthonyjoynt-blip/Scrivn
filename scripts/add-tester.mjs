/**
 * Give a tester a Scrivn account while sign-up is shut. One step, from this machine:
 *
 *   node scripts/add-tester.mjs jane@example.com --name "Jane Smith" --company "Smith Restoration"
 *
 *   --name "First Last"    their name (the company's name falls back to it, as on sign-up)
 *   --company "Name"       their company, which names their organization
 *   --dry-run              say what would be made and the email that would go; change nothing
 *   --no-email             make the account but send nothing: you tell them yourself
 *
 * The account is the same as a sign-up's (lib/accountMaking.ts): the user, their profile, their own
 * organization with them as owner, the trial check. It is made with the email confirmed and no
 * password. They get one plain-text email from no-reply@scrivn.ca, no links, saying to set a password
 * at scrivn.ca/forgot-password, then try Exterior → From photos or Scrivn Scan. The wording is
 * lib/testerAccounts.ts `testerEmail`.
 *
 * Safe to run twice: an address that already has an account is reported and nothing changes.
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and (unless --no-email) RESEND_API_KEY in
 * .env.local. If production sets GUARD_HASH_SECRET, put it in .env.local too, so the one-trial check
 * hashes the address as the site does.
 *
 *   node scripts/list-testers.mjs      who this has made, and whether they have signed in
 */
import { day, serviceClient, setting, testerCode } from "./testers-common.mjs";

const USAGE = `node scripts/add-tester.mjs <email> [--name "First Last"] [--company "Company name"] [--dry-run] [--no-email]`;

class UsageError extends Error {}

function parse(argv) {
  const out = { email: null, fullName: "", companyName: "", dryRun: false, noEmail: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const [flag, inline] = arg.startsWith("--") && eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, null];
    if (flag === "--name" || flag === "--company") {
      const value = inline ?? argv[++i];
      if (value === undefined || (inline === null && value.startsWith("--"))) throw new UsageError(`${flag} needs a value, in quotes if it has spaces.`);
      if (flag === "--name") out.fullName = value;
      else out.companyName = value;
    } else if (flag === "--dry-run" && inline === null) out.dryRun = true;
    else if (flag === "--no-email" && inline === null) out.noEmail = true;
    else if (arg.startsWith("-")) throw new UsageError(`Unknown option ${arg}. Nothing was done.`);
    else if (out.email === null) out.email = arg;
    else throw new UsageError(`One email address at a time (got ${out.email} and ${arg}). Nothing was done.`);
  }
  if (out.email === null) throw new UsageError("Give the tester's email address. Nothing was done.");
  return out;
}

const indent = (text, pad) => text.split("\n").map((l) => (l ? pad + l : "")).join("\n");

try {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  const args = parse(process.argv.slice(2));
  const app = await testerCode();
  app.planTester({ email: args.email, fullName: args.fullName, companyName: args.companyName }); // a bad address stops here, before any connection
  const { db, host } = await serviceClient();
  console.log(`Supabase: ${host}`);
  // With no way to email, refuse before making anything — unless there is nothing to make.
  if (!args.noEmail && !args.dryRun && !setting("RESEND_API_KEY") && !(await app.findAccount(db, args.email))) {
    throw new Error("RESEND_API_KEY is not in .env.local, so the email can't go. Add --no-email to make the account and tell them yourself. Nothing was done.");
  }

  const send = args.noEmail ? null : (m) => app.sendEmail({ to: m.to, subject: m.subject, text: m.text });
  const result = await app.addTester(db, { email: args.email, fullName: args.fullName, companyName: args.companyName }, { dryRun: args.dryRun, send });
  const { plan } = result;

  if (result.outcome === "exists") {
    const a = result.account;
    const how = a.madeByAddTester ? "made with add-tester" : "made";
    const signedIn = a.lastSignInAt ? `last signed in ${day(a.lastSignInAt)}` : "not signed in yet";
    console.log(`${a.email} already has a Scrivn account (${how} ${day(a.createdAt)}, ${signedIn}). Nothing changed.`);
    console.log("If they can't get in, they set a new password at scrivn.ca/forgot-password.");
    process.exit(0);
  }

  const verb = result.outcome === "dry-run" ? "would" : null;
  if (verb) console.log("Dry run: nothing is made and nothing is sent.\n");
  console.log(verb ? `Would make a Scrivn account for ${plan.email}` : `Made a Scrivn account for ${plan.email}`);
  console.log(`  Name:          ${plan.fullName || "(none given)"}`);
  if (result.outcome === "made" && !result.organization) {
    console.log("  Organization:  NONE FOUND. The sign-up trigger (handle_new_user) did not make one; they can't save claims until it is fixed.");
  } else {
    const org = result.outcome === "made" ? result.organization : { name: plan.organizationName, role: "owner" };
    console.log(`  Organization:  ${org.name} (${verb ? "they would be its" : "they are its"} ${org.role})`);
  }
  console.log(`  Signing in:    email confirmed, no password: they set one with Forgot password`);

  const tellThem = `Go to scrivn.ca/forgot-password, enter ${plan.email}, and choose a password from the email that comes.`;
  if (result.outcome === "dry-run") {
    if (args.noEmail) console.log(`  Email:         none (--no-email). You'd tell them: ${tellThem}`);
    else console.log(`  Email:         would go from no-reply@scrivn.ca:\n\n    Subject: ${result.message.subject}\n\n${indent(result.message.text, "    ")}`);
    process.exit(0);
  }

  if (result.emailed === null) {
    console.log(`  Email:         not sent (--no-email). Tell them: ${tellThem}`);
  } else if (result.emailed.sent) {
    console.log(`  Email:         sent from no-reply@scrivn.ca ("${result.message.subject}")`);
  } else {
    console.log(`  Email:         DID NOT GO (${result.emailed.reason}).`);
    console.log(`\nThe account is made. Send them this yourself:\n\n${indent(result.message.text, "    ")}`);
    process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  if (err instanceof UsageError || err?.name === "TesterInputError") console.error(`\n${USAGE}`);
  process.exit(1);
}
