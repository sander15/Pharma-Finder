/**
 * Pharmafind standard catalog. This is the single shared vocabulary of catalog IDs (PF-nnnn) and
 * reference IDs (REF-...) used by the drug-reference mock AND by every POS feed / CSV file, so no
 * translation layer exists anywhere (project rule: external data already uses our standard format).
 * Demo data only; not medical advice.
 */
export interface ReferenceSeed {
  referenceId: string;
  activeIngredient: string;
  brandName: string;
  genericName: string;
  description: string;
}

export interface ProductSeed {
  catalogId: string;
  brandName: string;
  genericName: string;
  presentation: string;
  dosage: string;
  reference: string;
}

export const REFERENCE_ENTRIES: ReferenceSeed[] = [
  { referenceId: "REF-ADVIL", activeIngredient: "Ibuprofen", brandName: "Advil", genericName: "Ibuprofen", description: "NSAID pain reliever and fever reducer." },
  { referenceId: "REF-MOTRIN", activeIngredient: "Ibuprofen", brandName: "Motrin", genericName: "Ibuprofen", description: "NSAID pain reliever and fever reducer." },
  { referenceId: "REF-IBU-GENERIC", activeIngredient: "Ibuprofen", brandName: "Generic", genericName: "Ibuprofen", description: "Store-brand ibuprofen, same active ingredient." },
  { referenceId: "REF-TYLENOL", activeIngredient: "Acetaminophen", brandName: "Tylenol", genericName: "Acetaminophen", description: "Pain reliever and fever reducer (non-NSAID)." },
  { referenceId: "REF-AMOX-GENERIC", activeIngredient: "Amoxicillin", brandName: "Generic", genericName: "Amoxicillin", description: "Penicillin-class antibiotic. Prescription required." },
  { referenceId: "REF-GLUCOPHAGE", activeIngredient: "Metformin", brandName: "Glucophage", genericName: "Metformin", description: "Oral medicine for type 2 diabetes. Prescription required." },
  { referenceId: "REF-METFORMIN-GENERIC", activeIngredient: "Metformin", brandName: "Generic", genericName: "Metformin", description: "Generic metformin. Prescription required." },
  { referenceId: "REF-CLARITIN", activeIngredient: "Loratadine", brandName: "Claritin", genericName: "Loratadine", description: "Non-drowsy antihistamine for allergy relief." },
  { referenceId: "REF-ZYRTEC", activeIngredient: "Cetirizine", brandName: "Zyrtec", genericName: "Cetirizine", description: "Antihistamine for allergy relief." },
  { referenceId: "REF-ZESTRIL", activeIngredient: "Lisinopril", brandName: "Zestril", genericName: "Lisinopril", description: "ACE inhibitor for blood pressure. Prescription required." },
  { referenceId: "REF-PRILOSEC", activeIngredient: "Omeprazole", brandName: "Prilosec OTC", genericName: "Omeprazole", description: "Proton-pump inhibitor for frequent heartburn." },
  { referenceId: "REF-VENTOLIN", activeIngredient: "Albuterol", brandName: "Ventolin HFA", genericName: "Albuterol", description: "Rescue inhaler for asthma. Prescription required." },
];

export const PRODUCTS: ProductSeed[] = [
  { catalogId: "PF-1001", brandName: "Advil", genericName: "Ibuprofen", presentation: "Tablet, 50 count", dosage: "200 mg", reference: "REF-ADVIL" },
  { catalogId: "PF-1002", brandName: "Motrin IB", genericName: "Ibuprofen", presentation: "Tablet, 100 count", dosage: "200 mg", reference: "REF-MOTRIN" },
  { catalogId: "PF-1003", brandName: "Generic", genericName: "Ibuprofen", presentation: "Tablet, 100 count", dosage: "400 mg", reference: "REF-IBU-GENERIC" },
  { catalogId: "PF-1004", brandName: "Children's Motrin", genericName: "Ibuprofen", presentation: "Oral suspension, 4 fl oz", dosage: "100 mg/5 mL", reference: "REF-MOTRIN" },
  { catalogId: "PF-1005", brandName: "Tylenol", genericName: "Acetaminophen", presentation: "Caplet, 100 count", dosage: "500 mg", reference: "REF-TYLENOL" },
  { catalogId: "PF-1006", brandName: "Children's Tylenol", genericName: "Acetaminophen", presentation: "Oral suspension, 4 fl oz", dosage: "160 mg/5 mL", reference: "REF-TYLENOL" },
  { catalogId: "PF-1007", brandName: "Generic", genericName: "Amoxicillin", presentation: "Capsule, 21 count", dosage: "500 mg", reference: "REF-AMOX-GENERIC" },
  { catalogId: "PF-1008", brandName: "Generic", genericName: "Amoxicillin", presentation: "Oral suspension, 100 mL", dosage: "250 mg/5 mL", reference: "REF-AMOX-GENERIC" },
  { catalogId: "PF-1009", brandName: "Glucophage", genericName: "Metformin", presentation: "Tablet, 60 count", dosage: "500 mg", reference: "REF-GLUCOPHAGE" },
  { catalogId: "PF-1010", brandName: "Generic", genericName: "Metformin", presentation: "Tablet, 90 count", dosage: "850 mg", reference: "REF-METFORMIN-GENERIC" },
  { catalogId: "PF-1011", brandName: "Claritin", genericName: "Loratadine", presentation: "Tablet, 30 count", dosage: "10 mg", reference: "REF-CLARITIN" },
  { catalogId: "PF-1012", brandName: "Zyrtec", genericName: "Cetirizine", presentation: "Tablet, 30 count", dosage: "10 mg", reference: "REF-ZYRTEC" },
  { catalogId: "PF-1013", brandName: "Zestril", genericName: "Lisinopril", presentation: "Tablet, 30 count", dosage: "10 mg", reference: "REF-ZESTRIL" },
  { catalogId: "PF-1014", brandName: "Prilosec OTC", genericName: "Omeprazole", presentation: "Delayed-release tablet, 28 count", dosage: "20 mg", reference: "REF-PRILOSEC" },
  { catalogId: "PF-1015", brandName: "Ventolin HFA", genericName: "Albuterol", presentation: "Inhaler, 200 actuations", dosage: "90 mcg/actuation", reference: "REF-VENTOLIN" },
];
