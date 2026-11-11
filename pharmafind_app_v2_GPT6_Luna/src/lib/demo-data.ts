import type { Listing, Pharmacy, Product } from "./domain";

export const products: Product[] = [
  { catalogId: "PF-1001", brandName: "Paracetamol", genericName: "Acetaminophen", presentation: "Tableta", strength: "500 mg", packSize: "20 tabletas", category: "Alivio del dolor" },
  { catalogId: "PF-1002", brandName: "Paracetamol", genericName: "Acetaminophen", presentation: "Jarabe", strength: "120 mg / 5 ml", packSize: "120 ml", category: "Alivio del dolor" },
  { catalogId: "PF-2001", brandName: "Loratadina", genericName: "Loratadina", presentation: "Tableta", strength: "10 mg", packSize: "10 tabletas", category: "Alergia" },
  { catalogId: "PF-3001", brandName: "Omeprazol", genericName: "Omeprazol", presentation: "Cápsula", strength: "20 mg", packSize: "14 cápsulas", category: "Salud digestiva" },
  { catalogId: "PF-4001", brandName: "Ibuprofeno", genericName: "Ibuprofeno", presentation: "Tableta", strength: "400 mg", packSize: "20 tabletas", category: "Alivio del dolor" },
  { catalogId: "PF-5001", brandName: "Amoxicilina", genericName: "Amoxicilina", presentation: "Cápsula", strength: "500 mg", packSize: "21 cápsulas", category: "Antibiótico" },
];

export const initialPharmacies: Pharmacy[] = [
  { id: "farmacia-central", name: "Farmacia Central", address: "Av. Reforma 12-40, Zona 10", latitude: 14.5995, longitude: -90.5133, verified: true, accessible: true, lastUpdated: "2026-11-10T16:45:00.000Z" },
  { id: "botica-norte", name: "Botica del Norte", address: "6a Avenida 3-21, Zona 1", latitude: 14.6412, longitude: -90.5131, verified: true, accessible: false, lastUpdated: "2026-11-08T10:00:00.000Z" },
  { id: "salud-zona-4", name: "Farmacia Salud Zona 4", address: "Ruta 3, 4-18, Zona 4", latitude: 14.6213, longitude: -90.5172, verified: true, accessible: true, lastUpdated: "2026-11-10T14:20:00.000Z" },
  { id: "farmacia-pendiente", name: "Farmacia La Esperanza", address: "Calzada Roosevelt, Zona 7", latitude: 14.6236, longitude: -90.5524, verified: false, accessible: null, lastUpdated: "2026-11-10T12:00:00.000Z" },
];

export const initialListings: Listing[] = [
  { id: "fc-1001", pharmacyId: "farmacia-central", catalogId: "PF-1001", stock: 14, price: 18.5 },
  { id: "fc-1002", pharmacyId: "farmacia-central", catalogId: "PF-1002", stock: 6, price: 32 },
  { id: "fc-2001", pharmacyId: "farmacia-central", catalogId: "PF-2001", stock: 22, price: 24 },
  { id: "fc-3001", pharmacyId: "farmacia-central", catalogId: "PF-3001", stock: 0, price: 36 },
  { id: "bn-1001", pharmacyId: "botica-norte", catalogId: "PF-1001", stock: 8, price: 16 },
  { id: "bn-2001", pharmacyId: "botica-norte", catalogId: "PF-2001", stock: 11, price: 21.5 },
  { id: "bn-4001", pharmacyId: "botica-norte", catalogId: "PF-4001", stock: 18, price: 22 },
  { id: "sz4-1001", pharmacyId: "salud-zona-4", catalogId: "PF-1001", stock: 4, price: 20 },
  { id: "sz4-1002", pharmacyId: "salud-zona-4", catalogId: "PF-1002", stock: 9, price: 29.75 },
  { id: "sz4-5001", pharmacyId: "salud-zona-4", catalogId: "PF-5001", stock: 5, price: 48 },
  { id: "pending-1001", pharmacyId: "farmacia-pendiente", catalogId: "PF-1001", stock: 30, price: 11 },
];

export const demoOrigin = { latitude: 14.603, longitude: -90.523 };

export const registrationRequests = [
  { id: "VR-2026-014", pharmacy: "Farmacia La Esperanza", license: "REG-44918-GT", submitted: "Hoy, 09:42", status: "Pendiente de revisión" },
  { id: "VR-2026-012", pharmacy: "Botica del Norte", license: "REG-23841-GT", submitted: "Ayer, 15:18", status: "Verificada" },
];
