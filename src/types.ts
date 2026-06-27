export interface Service {
  id: string;
  name: string;
  durationMin: number;
  price: number;
}

// A fully-loaded salon (tenant) with its services. Threaded through the app
// so one server can serve many salons.
export interface SalonContext {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  timezone: string;
  openHour: number;
  closeHour: number;
  closedWeekdays: number[];
  slotStepMin: number;
  services: Service[];
}

export interface Appointment {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h)
  serviceId: string;
  customerName: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResult {
  reply: string;
  // Populated when an appointment was just booked (UI uses it for the reminder demo).
  booking?: Appointment;
}

export interface Session {
  history: ChatMessage[];
  lastBooking?: Appointment;
  // Slot-filling state used only by the offline mock brain.
  mock: {
    serviceId?: string;
    date?: string;
    time?: string;
    customerName?: string;
  };
}
