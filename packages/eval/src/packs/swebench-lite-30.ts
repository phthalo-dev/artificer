/**
 * Curated 30-instance subset of SWE-bench Lite for identity evals
 * (`artificer eval run --pack swebench-lite-30`) and maintainer bench.
 *
 * Includes all 6 mini-suite instances, at least one task per repo (12/12),
 * and a mix of difficulty (FAIL_TO_PASS 1–12). Django is overweighted to
 * reflect its share of the full set.
 */
export const SWE_BENCH_LITE_30_PACK_ID = 'swebench-lite-30';

export const SWE_BENCH_LITE_30 = {
  id: SWE_BENCH_LITE_30_PACK_ID,
  name: 'SWE-bench Lite curated (30 tasks)',
  description:
    'Balanced 30-instance subset of SWE-bench Lite for pre-full-run benchmarking.',
  kind: 'swebench' as const,
  dataset: 'princeton-nlp/SWE-bench_Lite',
  split: 'test',
  config: 'default',
  instanceIds: [
    'pallets__flask-4045',
    'psf__requests-2674',
    'pytest-dev__pytest-5221',
    'scikit-learn__scikit-learn-13497',
    'sympy__sympy-16503',
    'astropy__astropy-6938',
    'astropy__astropy-12907',
    'django__django-10914',
    'django__django-11001',
    'django__django-11564',
    'django__django-11742',
    'django__django-12747',
    'django__django-13220',
    'django__django-14997',
    'matplotlib__matplotlib-22835',
    'matplotlib__matplotlib-23913',
    'mwaskom__seaborn-2848',
    'pydata__xarray-4094',
    'pydata__xarray-5131',
    'pylint-dev__pylint-5859',
    'pylint-dev__pylint-7228',
    'pytest-dev__pytest-5103',
    'pytest-dev__pytest-7168',
    'scikit-learn__scikit-learn-10297',
    'scikit-learn__scikit-learn-15535',
    'sphinx-doc__sphinx-7738',
    'sphinx-doc__sphinx-8474',
    'sympy__sympy-11400',
    'sympy__sympy-13177',
    'sympy__sympy-19007',
  ],
} as const;
