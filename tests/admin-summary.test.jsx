import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SummaryTab from '../src/components/admin/SummaryTab';
import { summaryReport } from './fixtures/summary-report';

const renderTab = (props = {}) => render(<SummaryTab data={summaryReport} onOpenSession={() => {}} onOpenUser={() => {}} onOpenFeedback={() => {}} {...props} />);

describe('admin overview', () => {
  it('shows people, sources, steps and problems in plain terms', () => {
    renderTab();
    expect(screen.getByText(/8 stayed or did something · 4 left right away/)).toBeInTheDocument();
    expect(screen.getByText(/Not counted: 30 visits by you and 140 by bots/)).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Google/ })).toBeInTheDocument();
    expect(screen.getByText('Opened the editor but added no data'.toLowerCase())).toBeInTheDocument();
    expect(screen.queryByText(/on a phone/)).not.toBeInTheDocument(); // zero counts are hidden
    expect(screen.getByText('juggernaut exploration')).toBeInTheDocument();
    expect(screen.getByText(/Unable to preload CSS/)).toBeInTheDocument();
  });

  it('opens a signup, a journey and feedback', () => {
    const onOpenUser = vi.fn(), onOpenSession = vi.fn(), onOpenFeedback = vi.fn();
    renderTab({ onOpenUser, onOpenSession, onOpenFeedback });
    fireEvent.click(screen.getByRole('button', { name: 'new@example.test' }));
    expect(onOpenUser).toHaveBeenCalledWith(summaryReport.signups[0].user_id);
    fireEvent.click(screen.getAllByRole('button', { name: 'Journey' })[1]);
    expect(onOpenSession).toHaveBeenCalledWith('tab-1');
    fireEvent.click(screen.getByRole('button', { name: 'Read them' }));
    expect(onOpenFeedback).toHaveBeenCalled();
  });

  it('says so when nothing happened', () => {
    renderTab({ data: { ...summaryReport, sources: [], pages: [], recent: [], signups: [], problems: { errors: [], failed_searches: [], stuck: [], feedback_open: 0 } } });
    expect(screen.getAllByText('No real visitors in this period.')).toHaveLength(2);
    expect(screen.getByText('Nothing stood out in this period.')).toBeInTheDocument();
    expect(screen.queryByText('New signups', { selector: 'h2' })).not.toBeInTheDocument();
  });
});
