import {NextResponse} from "next/server";
import {getListings,pharmacies,products} from "../../../pharmafind";
export async function GET(){return NextResponse.json({pharmacies,products,listingCount:getListings().length,verifiedCount:pharmacies.filter(p=>p.verification==="Verified").length,syncWindowHours:24})}
