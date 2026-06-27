export interface Pairing {
  id: string;
  round_id: string;
  table_number: number;
  player1_id: string;
  player2_id?: string; // undefined means bye
  is_bye: boolean;
  override_note?: string;
}

// Joined view with player names for display
export interface PairingView extends Pairing {
  player1_name: string;
  player2_name?: string;
}
