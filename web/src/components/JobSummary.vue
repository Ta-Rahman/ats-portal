<script setup>
// Kurzdarstellung einer Stelle in Listen (Startseite, Stellenliste).
import { formatDate } from '../labels.js';
import { employmentTypeLabel, useEmploymentTypes } from '../employmentTypes.js';

defineProps({
  job: { type: Object, required: true },
  headingLevel: { type: Number, default: 2 },
});
useEmploymentTypes();
</script>

<template>
  <article class="job-summary">
    <component :is="`h${headingLevel}`" class="job-summary__title">
      <RouterLink :to="{ name: 'job', params: { id: job.id } }">{{ job.title }}</RouterLink>
    </component>
    <p class="job-summary__meta">
      <span>{{ job.location }}</span>
      <span aria-hidden="true"> · </span>
      <span>{{ employmentTypeLabel(job.employment_type) }}</span>
      <span aria-hidden="true"> · </span>
      <span>veröffentlicht am <time :datetime="job.published_at">{{ formatDate(job.published_at) }}</time></span>
    </p>
  </article>
</template>
