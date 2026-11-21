<script setup>
// Fehlerübersicht oben im Formular (gleiches Markup wie im Bewerbungsformular): role="alert",
// per focus() ansteuerbar; Einträge mit target verlinken auf das betroffene Feld.
// items: [{ target?: Element-ID, label?: Feldname, message }]
import { ref } from 'vue';

defineProps({
  items: { type: Array, required: true },
  title: { type: String, default: 'Bitte korrigieren Sie folgende Angaben' },
});

const root = ref(null);

function focusTarget(id) {
  document.getElementById(id)?.focus();
}

defineExpose({ focus: () => root.value?.focus() });
</script>

<template>
  <div v-if="items.length" ref="root" class="error-summary" tabindex="-1" role="alert"
       aria-labelledby="fehleruebersicht-titel">
    <h2 id="fehleruebersicht-titel">{{ title }}</h2>
    <ul>
      <li v-for="(item, i) in items" :key="i">
        <a v-if="item.target" :href="`#${item.target}`" @click.prevent="focusTarget(item.target)">
          {{ item.label ? `${item.label}: ` : '' }}{{ item.message }}
        </a>
        <template v-else>{{ item.message }}</template>
      </li>
    </ul>
  </div>
</template>
