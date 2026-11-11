import {NextResponse} from "next/server";
import {getListings,products,searchListings} from "../../../pharmafind";
export async function GET(req:Request){const u=new URL(req.url),q=(u.searchParams.get("q")||"").toLowerCase(),a=u.searchParams.get("accessible")==="true";const found=products.filter(p=>`${p.brandName} ${p.genericName} ${p.presentation} ${p.dosage} ${p.catalogId}`.toLowerCase().includes(q));return NextResponse.json({products:found.map(p=>({...p,listings:searchListings(getListings(),p.catalogId,a)}))})}
