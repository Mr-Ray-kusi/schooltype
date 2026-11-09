import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Download, Printer, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/authcontext';
import { useLivePoll } from '../hooks/useLivePoll';
import { forceGet, invalidateCache, peekCache, staleGet, REPORT_CACHE_MS } from '../utils/requestCache';
import ClassReportBoard from '../components/ClassReportBoard';
import ConfirmTypedDeleteModal from '../components/ConfirmTypedDeleteModal';
import {
  downloadStudentReportCardsPdf,
  downloadSubjectRankingsPdf,
  rankClassRoster,
} from '../utils/reportCardPdf';

const studentKey = (row) => row.student_id || `${row.student_name}-${row.class_name}`;
const CLEAR_SCORES_PHRASE = 'CLEAR ALL SCORES NOW';

const ReportCards = () => {
  const { school, canWrite, canDownload } = useAuth();
  const [scores, setScores] = useState([]);
  const [roster, setRoster] = useState([]);
  const [classCounts, setClassCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedTerm, setSelectedTerm] = useState('all');
  const [selectedStudentKeys, setSelectedStudentKeys] = useState([]);
  const [clearing, setClearing] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [filterOptions, setFilterOptions] = useState({ classes: [], terms: [] });

  const loadScores = useCallback(
    async ({ silent = false, force = false } = {}) => {
      const cacheKey = `report-cards:scores:${selectedClass || 'classes'}:${selectedTerm}`;
      if (!silent && !force) {
        const cached = peekCache(cacheKey);
        if (cached) {
          setScores(Array.isArray(cached.scores) ? cached.scores : []);
          setRoster(Array.isArray(cached.roster) ? cached.roster : []);
          setClassCounts(cached.classCounts || {});
          if (cached.filters) setFilterOptions(cached.filters);
          setLoading(false);
        }
      }
      try {
        const fetcher = async () => {
          const res = await axios.get('/api/report-cards/scores', {
            params: {
              all: selectedClass ? '1' : undefined,
              class: selectedClass || undefined,
              term: selectedTerm !== 'all' ? selectedTerm : undefined,
              refresh: force ? '1' : undefined,
            },
          });
          return res.data;
        };
        const data = silent
          ? await staleGet(cacheKey, fetcher, 0)
          : force
            ? await forceGet(cacheKey, fetcher)
            : await staleGet(cacheKey, fetcher, REPORT_CACHE_MS);
        setScores(Array.isArray(data) ? data : data.scores || []);
        setRoster(Array.isArray(data?.roster) ? data.roster : []);
        setClassCounts(data?.classCounts || {});
        if (data?.filters) setFilterOptions(data.filters);
      } catch (err) {
        if (!silent) {
          toast.error(err.response?.data?.error || 'Failed to load teacher scores');
          setScores([]);
          setRoster([]);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [selectedClass, selectedTerm]
  );

  useEffect(() => {
    loadScores({ silent: false });
  }, [loadScores]);

  useEffect(() => {
    setSelectedStudentKeys([]);
  }, [selectedClass, selectedTerm]);

  useLivePoll(() => loadScores({ silent: true }), 60000, !loading);

  const ranked = useMemo(
    () =>
      selectedClass
        ? rankClassRoster(roster, scores, { className: selectedClass, term: selectedTerm })
        : [],
    [roster, scores, selectedClass, selectedTerm]
  );

  const allStudentsSelected =
    ranked.length > 0 && ranked.every((student) => selectedStudentKeys.includes(studentKey(student)));

  const toggleStudent = (key) => {
    setSelectedStudentKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const toggleSelectAllStudents = () => {
    if (allStudentsSelected) {
      setSelectedStudentKeys([]);
      return;
    }
    setSelectedStudentKeys(ranked.map((student) => studentKey(student)));
  };

  const closeClearConfirm = () => {
    if (clearing) return;
    setClearConfirmOpen(false);
  };

  const handleClearAllScores = () => {
    setClearConfirmOpen(true);
  };

  const confirmClearAllScores = async () => {
    if (!canWrite) {
      toast.error('Your term plan has ended. Scores stay view-only until you renew.');
      return;
    }
    setClearing(true);
    try {
      const { data } = await axios.delete('/api/report-cards/scores');
      invalidateCache('report-cards');
      setScores([]);
      setSelectedStudentKeys([]);
      setClearConfirmOpen(false);
      toast.success(data?.message || 'Teacher score entries cleared');
      await loadScores({ silent: false, force: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to clear teacher score entries');
    } finally {
      setClearing(false);
    }
  };

  const handleRankingsPdf = () => {
    if (!canDownload) {
      toast.error('Downloads are locked until the term plan is renewed.');
      return;
    }
    if (!selectedClass) {
      toast.error('Choose a class first');
      return;
    }
    if (!scores.length) {
      toast.error('No scores to export for this class');
      return;
    }
    downloadSubjectRankingsPdf({
      scores,
      schoolName: school?.name || 'School',
      className: selectedClass,
      term: selectedTerm,
      subject: 'all',
    });
    toast.success('Subject rankings PDF downloaded');
  };

  const handleStudentCardsPdf = (studentIds) => {
    if (!canDownload) {
      toast.error('Downloads are locked until the term plan is renewed.');
      return;
    }
    const ids = studentIds || selectedStudentKeys;
    if (!ids.length) {
      toast.error('Select at least one student to print a personal report');
      return;
    }
    if (!scores.length) {
      toast.error('No scores found for the selected students');
      return;
    }
    const count = downloadStudentReportCardsPdf({
      scores,
      schoolName: school?.name || 'School',
      className: selectedClass,
      term: selectedTerm,
      studentIds: ids,
    });
    toast.success(
      count === 1
        ? 'Personal student report downloaded'
        : `${count} reports downloaded, each named after the student`
    );
  };

  return (
    <div className="space-y-4">
      {selectedClass ? null : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="page-title">Report Cards</h1>
            <p className="mt-1 text-sm text-slate-200">Open a class to see every student ranked by total marks.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                invalidateCache('report-cards');
                loadScores({ silent: false, force: true });
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-70"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleClearAllScores}
              disabled={clearing}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {clearing ? 'Clearing...' : 'Clear scores'}
            </button>
          </div>
        </div>
      )}

      <ClassReportBoard
        classes={filterOptions.classes}
        classCounts={classCounts}
        selectedClass={selectedClass}
        onSelectClass={setSelectedClass}
        selectedTerm={selectedTerm}
        onSelectTerm={setSelectedTerm}
        terms={filterOptions.terms || []}
        ranked={ranked}
        loading={loading}
        selectable={Boolean(selectedClass)}
        selectedKeys={selectedStudentKeys}
        onToggleStudent={toggleStudent}
        onToggleAll={toggleSelectAllStudents}
        studentKey={studentKey}
        toolbar={
          selectedClass ? (
            <>
              <button
                type="button"
                onClick={handleRankingsPdf}
                disabled={!canDownload}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Rankings
              </button>
              <button
                type="button"
                onClick={() => handleStudentCardsPdf()}
                disabled={!canDownload}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                <Printer className="h-4 w-4" />
                Print selected
              </button>
            </>
          ) : null
        }
        renderRowActions={
          selectedClass
            ? (student) => (
                <button
                  type="button"
                  onClick={() => handleStudentCardsPdf([studentKey(student)])}
                  className="rounded-md p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
                  aria-label={`Print ${student.student_name}`}
                >
                  <Printer className="h-4 w-4" />
                </button>
              )
            : null
        }
      />

      <ConfirmTypedDeleteModal
        open={clearConfirmOpen}
        title="Clear all scores?"
        description="This permanently deletes every teacher score for this school. Type the phrase below to confirm."
        confirmText={CLEAR_SCORES_PHRASE}
        actionLabel="Clear all scores"
        busyLabel="Clearing…"
        busy={clearing}
        onClose={closeClearConfirm}
        onConfirm={confirmClearAllScores}
      />
    </div>
  );
};

export default ReportCards;
