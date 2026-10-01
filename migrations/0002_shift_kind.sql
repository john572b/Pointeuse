-- Type de journée : normal | intervention (appel d'urgence, heures supplémentaires uniquement)
ALTER TABLE shifts ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal';
