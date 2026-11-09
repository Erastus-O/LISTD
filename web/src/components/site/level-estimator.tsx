'use client'

import { useEffect, useState } from 'react'

const LEVELS = [
  { min: 0, max: 9, tag: 'L1', name: 'Level 1', note: 'First 5 jobs get a closer LISTD review' },
  { min: 10, max: 29, tag: 'L2', name: 'Level 2', note: 'With a 4.5 rating or more' },
  { min: 30, max: 9999, tag: 'L3', name: 'Level 3', note: 'With a 4.7 rating or more' },
]

/** For Pros page: slide completed jobs to see the level; highlights the row beside it. */
export function LevelEstimator() {
  const [jobs, setJobs] = useState(12)
  const idx = LEVELS.findIndex((l) => jobs >= l.min && jobs <= l.max)
  const level = LEVELS[idx]

  useEffect(() => {
    const rows = document.querySelectorAll('.s-levels .s-lv')
    rows.forEach((r, k) => r.classList.toggle('m-on-level', k === idx))
  }, [idx])

  return (
    <div className="m-est">
      <label htmlFor="m-jobs">
        Jobs completed in a role{' '}
        <output htmlFor="m-jobs">
          {jobs}
          {jobs === 40 ? '+' : ''} {jobs === 1 ? 'job' : 'jobs'}
        </output>
      </label>
      <input
        id="m-jobs"
        type="range"
        min={0}
        max={40}
        value={jobs}
        onChange={(e) => setJobs(Number(e.target.value))}
      />
      <div className="res">
        <b>{level.tag}</b>
        <span>
          {level.name}
          <small>{level.note}</small>
        </span>
      </div>
    </div>
  )
}
