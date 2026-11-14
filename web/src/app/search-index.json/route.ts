import { getSearchIndex } from "@/lib/queries-hiw";

// Every company with a page, for the search box to filter in the browser: [cik, name, ticker, size rank].
export const dynamic = "force-static";
export const revalidate = 3600;

export async function GET() {
  return Response.json(await getSearchIndex());
}
