import {NextResponse} from "next/server";
import {importFeed} from "../../../pharmafind";
export async function POST(req:Request){let body:unknown;try{body=await req.json()}catch{return NextResponse.json({error:"Request must contain valid JSON."},{status:400})}const rows=Array.isArray(body)?body:(body as {rows?:unknown})?.rows;if(!Array.isArray(rows))return NextResponse.json({error:"Expected standard-format feed rows."},{status:400});const result=importFeed(rows);return NextResponse.json(result,{status:result.accepted?200:422})}
