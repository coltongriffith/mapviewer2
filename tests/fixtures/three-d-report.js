// A small admin_get_three_d_usage response, shared by the unit and admin e2e tests.
export const threeDReport = {
  tracking_since: '2026-10-20T16:00:00Z',
  totals: {
    opens: 14, active_users: 3, data_sessions: 6, exports: 9, export_sessions: 4,
    projects_created: 5, projects_updated: 7, projects_deleted: 1, saves: 8, versions: 2,
    shares_created: 3, share_views: 11, share_forks: 1,
  },
  daily: [
    { d: '2026-10-19', opens: 3, active_users: 1, exports: 2, projects_created: 1, projects_updated: 2 },
    { d: '2026-10-20', opens: 5, active_users: 2, exports: 4, projects_created: 2, projects_updated: 3 },
    { d: '2026-10-21', opens: 6, active_users: 2, exports: 3, projects_created: 2, projects_updated: 2 },
  ],
  exports_by_kind: [
    { kind: 'png', n: 6, sessions: 3 }, { kind: 'section', n: 2, sessions: 2 }, { kind: 'layers', n: 1, sessions: 1 },
  ],
  data_by_kind: [
    { kind: 'collar', sessions: 6 }, { kind: 'assay', sessions: 5 }, { kind: 'terrain', sessions: 2 }, { kind: 'litho', sessions: 1 },
  ],
  top_projects: [
    { id: '10000000-0000-4000-8000-000000000001', name: 'Rails Zone long section', owner_email: 'ana@example.test',
      user_id: '00000000-0000-4000-8000-00000000000a', created_at: '2026-10-12T15:00:00Z', updated_at: '2026-10-21T15:00:00Z',
      deleted: false, saves: 4, shares: 2, share_views: 9, versions: 2, activity: 8 },
    { id: '10000000-0000-4000-8000-000000000002', name: 'North block', owner_email: 'ben@example.test',
      user_id: '00000000-0000-4000-8000-00000000000b', created_at: '2026-10-20T15:00:00Z', updated_at: '2026-10-20T15:30:00Z',
      deleted: true, saves: 1, shares: 0, share_views: 0, versions: 0, activity: 1 },
  ],
  shared_maps: {
    totals: {
      created_2d: 6, created_2d_agent: 2, created_3d: 3, viewed_2d: 12, viewed_3d: 11,
      live_2d: 40, live_3d: 4, lifetime_views_2d: 310, lifetime_views_3d: 27,
    },
    daily: [
      { d: '2026-10-19', created_2d: 2, created_3d: 1, viewed_2d: 3, viewed_3d: 2 },
      { d: '2026-10-20', created_2d: 1, created_3d: 1, viewed_2d: 4, viewed_3d: 5 },
      { d: '2026-10-21', created_2d: 3, created_3d: 1, viewed_2d: 5, viewed_3d: 4 },
    ],
    top: [
      { kind: 'map', title: 'Copper claims, Highland Valley', owner_email: 'ben@example.test', user_id: '00000000-0000-4000-8000-00000000000b',
        agent: false, views: 88, created_at: '2026-10-02T12:00:00Z', last_viewed_at: '2026-10-21T12:00:00Z', path: `/map/${'e'.repeat(32)}` },
      { kind: 'figure', title: 'RAILS ZONE', owner_email: 'ana@example.test', user_id: '00000000-0000-4000-8000-00000000000a',
        agent: false, views: 9, created_at: '2026-10-19T12:00:00Z', last_viewed_at: '2026-10-21T13:00:00Z', path: `/3d/share/${'a'.repeat(32)}` },
      { kind: 'map', title: null, owner_email: null, user_id: null, agent: true, views: 2,
        created_at: '2026-10-20T12:00:00Z', last_viewed_at: null, path: `/map/${'f'.repeat(32)}` },
    ],
  },
};
