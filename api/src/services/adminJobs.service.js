// Fachlogik der Stellenverwaltung (UC6) für Recruiter und Admin.
import * as jobsRepository from '../repositories/jobs.repository.js';
import { ConflictError, NotFoundError } from '../errors.js';

const JOB_NOT_FOUND = 'Stelle nicht gefunden';

export function listJobs() {
  return jobsRepository.findAllWithCounts();
}

export async function getJob(id) {
  const job = await jobsRepository.findById(id);
  if (!job) throw new NotFoundError(JOB_NOT_FOUND);
  return job;
}

export async function createJob(data, userId) {
  const id = await jobsRepository.insertDraft({
    title: data.title,
    location: data.location,
    employmentType: data.employment_type,
    description: data.description,
    createdBy: userId,
  });
  return getJob(id);
}

export async function updateJob(id, data) {
  const changed = await jobsRepository.updateFields(id, {
    title: data.title,
    location: data.location,
    employmentType: data.employment_type,
    description: data.description,
  });
  if (!changed) {
    await getJob(id); // 404, falls es die Stelle nicht gibt
    throw new ConflictError('JOB_CLOSED', 'Eine geschlossene Stelle kann nicht mehr bearbeitet werden.');
  }
  return getJob(id);
}

const STATUS_CONFLICT = {
  published: 'Nur ein Entwurf kann veröffentlicht werden.',
  closed: 'Nur eine veröffentlichte Stelle kann geschlossen werden.',
};

// target = 'published' (veröffentlichen) oder 'closed' (schließen).
async function changeStatus(id, target) {
  let changed;
  try {
    changed = await jobsRepository.changeStatus(id, target);
  } catch (err) {
    if (err.code === 'AT007') throw new ConflictError('JOB_STATUS_CONFLICT', STATUS_CONFLICT[target]);
    throw err;
  }
  if (!changed) {
    await getJob(id); // 404, falls es die Stelle nicht gibt
    throw new ConflictError('JOB_STATUS_CONFLICT', STATUS_CONFLICT[target]);
  }
  return getJob(id);
}

export const publishJob = (id) => changeStatus(id, 'published');
export const closeJob = (id) => changeStatus(id, 'closed');
