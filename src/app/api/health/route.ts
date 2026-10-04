import { NextResponse } from "next/server";
import { checkSystemHealth } from "@/server/health";

export async function GET() {
  const health = await checkSystemHealth();
  return NextResponse.json(health);
}
