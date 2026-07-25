import { AppointmentConfirmationAction } from 'src/common/enums';

export interface SendAppointmentConfirmationJob {
  to: string;
  patientName: string;
  appointmentDate: string;
  time: string;
  provider: string;
  specialty: string;
  facility: string;
  action: AppointmentConfirmationAction;
}
