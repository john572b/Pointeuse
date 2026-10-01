import { z } from "zod";

/** Schémas de validation partagés client / serveur. */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Adresse e-mail invalide.");

export const passwordSchema = z
  .string()
  .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
  .max(200, "Mot de passe trop long.");

export const firstNameSchema = z.string().trim().min(1, "Indiquez votre prénom.").max(60);

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide.");

export const absenceKinds = ["conge", "maladie", "recup", "sans_solde", "autre"] as const;
