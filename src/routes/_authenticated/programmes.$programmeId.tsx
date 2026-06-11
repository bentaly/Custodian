import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { getProgramme, updateProgramme, listClientTags } from '../../server/fns/programmes'
import {
  listFormFields,
  createFormField,
  updateFormField,
  deleteFormField,
} from '../../server/fns/form-fields'
import { TagInput } from '../../components/TagInput'
import { RichTextEditor } from '../../components/RichTextEditor'

export const Route = createFileRoute('/_authenticated/programmes/$programmeId')({
  loader: async ({ params }) => {
    const [programme, formFields, clientTags] = await Promise.all([
      getProgramme({ data: { id: params.programmeId } }),
      listFormFields({ data: { programmeId: params.programmeId } }),
      listClientTags(),
    ])
    return { programme, formFields, clientTags }
  },
  component: ProgrammeDetail,
})

const PROG_STATUS_LABELS = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
}

const PROG_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-500',
  active: 'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  date: 'Date',
  file: 'File',
  checkbox: 'Checkbox',
}

type LoadedProgramme = Awaited<ReturnType<typeof getProgramme>>
type FormField = LoadedProgramme['formFields'][number]

function ProgrammeDetail() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { programme, formFields, clientTags } = Route.useLoaderData()
  const canManage = ['superadmin', 'admin', 'manager'].includes(user.role)

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(programme.name)
  const [description, setDescription] = useState(programme.description ?? '')
  const [goal, setGoal] = useState(programme.goal ?? '')
  const [tags, setTags] = useState<string[]>((programme.tags ?? []) as string[])
  const [status, setStatus] = useState(programme.status)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [showAddField, setShowAddField] = useState(false)
  const [fieldLabel, setFieldLabel] = useState('')
  const [fieldType, setFieldType] = useState<FormField['fieldType']>('text')
  const [fieldRequired, setFieldRequired] = useState(false)
  const [fieldOptions, setFieldOptions] = useState('')
  const [addingField, setAddingField] = useState(false)
  const [fieldError, setFieldError] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaveError('')
    setSaving(true)
    try {
      await updateProgramme({
        data: {
          id: programme.id,
          name,
          description: description || undefined,
          goal: goal || undefined,
          tags,
          status,
        },
      })
      setEditing(false)
      router.invalidate()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddField(e: React.FormEvent) {
    e.preventDefault()
    setFieldError('')
    setAddingField(true)
    try {
      const options =
        fieldType === 'select' || fieldType === 'multi_select'
          ? fieldOptions
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined
      await createFormField({
        data: {
          programmeId: programme.id,
          label: fieldLabel,
          fieldType,
          required: fieldRequired,
          displayOrder: formFields.length,
          options,
        },
      })
      setShowAddField(false)
      setFieldLabel('')
      setFieldType('text')
      setFieldRequired(false)
      setFieldOptions('')
      router.invalidate()
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : 'Failed to add field')
    } finally {
      setAddingField(false)
    }
  }

  async function handleDeleteField(id: string) {
    await deleteFormField({ data: { id } })
    router.invalidate()
  }

  async function handleToggleRequired(field: FormField) {
    await updateFormField({ data: { id: field.id, required: !field.required } })
    router.invalidate()
  }

  const tags_ = (programme.tags ?? []) as string[]

  return (
    <div className="max-w-3xl space-y-8">
      <Link
        to="/programmes"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        ← Programmes
      </Link>

      {/* Programme header */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        {editing ? (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Description <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Themes</label>
              <TagInput value={tags} onChange={setTags} suggestions={clientTags} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Goal{' '}
                <span className="font-normal text-gray-400">— used by AI to score applications</span>
              </label>
              <RichTextEditor key={programme.id} defaultValue={goal} onChange={setGoal} />
            </div>
            {saveError && <p className="text-sm text-red-500">{saveError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setName(programme.name)
                  setDescription(programme.description ?? '')
                  setGoal(programme.goal ?? '')
                  setTags((programme.tags ?? []) as string[])
                  setStatus(programme.status)
                  setSaveError('')
                }}
                className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-gray-900">{programme.name}</h1>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PROG_STATUS_COLORS[programme.status]}`}
                >
                  {PROG_STATUS_LABELS[programme.status]}
                </span>
              </div>
              {programme.description && (
                <p className="mt-1 text-sm text-gray-500">{programme.description}</p>
              )}
              {tags_.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tags_.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {canManage && (
              <button
                onClick={() => setEditing(true)}
                className="shrink-0 rounded border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {/* Application form fields */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Application form fields</h2>
          {canManage && !showAddField && (
            <button
              onClick={() => setShowAddField(true)}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800"
            >
              Add field
            </button>
          )}
        </div>

        {showAddField && (
          <form
            onSubmit={handleAddField}
            className="rounded-lg border border-gray-300 bg-white p-4 space-y-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Label</label>
                <input
                  type="text"
                  value={fieldLabel}
                  onChange={(e) => setFieldLabel(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Type</label>
                <select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value as FormField['fieldType'])}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  {Object.entries(FIELD_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            {(fieldType === 'select' || fieldType === 'multi_select') && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Options <span className="text-gray-400">(comma-separated)</span>
                </label>
                <input
                  type="text"
                  value={fieldOptions}
                  onChange={(e) => setFieldOptions(e.target.value)}
                  placeholder="Option A, Option B, Option C"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={fieldRequired}
                onChange={(e) => setFieldRequired(e.target.checked)}
                className="rounded"
              />
              Required
            </label>
            {fieldError && <p className="text-sm text-red-500">{fieldError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={addingField}
                className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {addingField ? 'Adding…' : 'Add field'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddField(false)
                  setFieldLabel('')
                  setFieldType('text')
                  setFieldRequired(false)
                  setFieldOptions('')
                  setFieldError('')
                }}
                className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {formFields.length === 0 && !showAddField ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-8 text-center">
            <p className="text-sm text-gray-500">No form fields yet.</p>
            {canManage && (
              <p className="mt-1 text-sm text-gray-400">
                Add fields to define the application form for this programme.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {formFields.map((field, i) => (
              <div
                key={field.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="w-5 text-center text-xs text-gray-400">{i + 1}</span>
                  <div>
                    <span className="text-sm text-gray-900">{field.label}</span>
                    {field.required && (
                      <span className="ml-1.5 text-xs text-gray-400">*</span>
                    )}
                  </div>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    {FIELD_TYPE_LABELS[field.fieldType] ?? field.fieldType}
                  </span>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleRequired(field)}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      {field.required ? 'Make optional' : 'Make required'}
                    </button>
                    <button
                      onClick={() => handleDeleteField(field.id)}
                      className="text-xs text-gray-400 hover:text-red-500"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
