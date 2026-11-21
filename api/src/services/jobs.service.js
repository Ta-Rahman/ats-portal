// Fachlogik für öffentliche Stellen (UC1 Stellen durchsuchen, UC2 Stellendetail).
import * as jobsRepository from '../repositories/jobs.repository.js';
import { NotFoundError } from '../errors.js';

export function listPublishedJobs({ location, employment_type: employmentType } = {}) {
  return jobsRepository.findPublished({ location, employmentType });
}

export async function getPublishedJob(id) {
  const job = await jobsRepository.findPublishedById(id);
  if (!job) throw new NotFoundError('Stelle nicht gefunden');
  return job;
}
