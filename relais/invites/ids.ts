// Responsabilité : le format des identifiants de membre du réseau (12 hexadécimaux), partagé par routes et politique.
import { z } from 'zod';

export const ID_MEMBRE = z.string().regex(/^[a-f0-9]{12}$/);
