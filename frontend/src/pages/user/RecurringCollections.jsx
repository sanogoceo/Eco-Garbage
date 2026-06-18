import { useEffect, useState } from 'react'
import { CalendarClock, Loader2, MapPin, Pause, Play } from 'lucide-react'
import toast from 'react-hot-toast'
import { categoryApi, recurringApi } from '../../services/api'
import { getCurrentPosition } from '../../utils/geolocation'
import { PageHeader, PageLoader } from '../../components/common'
import StructuredAddressFields from '../../components/common/StructuredAddressFields'

export default function RecurringCollections() {
  const [categories, setCategories] = useState([])
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    category_id: '', frequency: 'weekly', day_of_week: 1, day_of_month: 1,
    preferred_time: '08:00', address: '', latitude: '', longitude: '',
    city: '', district: '', address_line: '', landmark: '',
    quantity_number: 1, notes: '',
  })

  const load = async () => {
    const results = await Promise.allSettled([
      categoryApi.list(), recurringApi.list(),
    ])
    if (results[0].status === 'fulfilled') {
      setCategories(results[0].value.data.data || [])
    }
    if (results[1].status === 'fulfilled') {
      setSchedules(results[1].value.data.data || [])
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const locate = async () => {
    try {
      const position = await getCurrentPosition()
      setForm((current) => ({
        ...current,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }))
      toast.success('Position GPS obtenue')
    } catch (error) {
      toast.error(error.message)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      await recurringApi.create(form)
      toast.success('Collecte recurrente programmee')
      await load()
    } catch (error) {
      toast.error(error.response?.data?.message || 'Programmation impossible')
    } finally {
      setSubmitting(false)
    }
  }

  const toggle = async (schedule) => {
    await recurringApi.update(schedule.uuid, { is_active: !schedule.is_active })
    await load()
  }

  if (loading) return <PageLoader />

  return (
    <div className="fade-up max-w-5xl mx-auto">
      <PageHeader title="Collectes recurrentes" subtitle="Programmez les passages reguliers pour votre foyer ou entreprise" />
      <div className="grid lg:grid-cols-[380px_1fr] gap-5">
        <form onSubmit={submit} className="card p-5 flex flex-col gap-4 h-fit">
          <h3 className="font-display font-bold flex items-center gap-2">
            <CalendarClock size={18} /> Nouveau programme
          </h3>
          <select className="input" required value={form.category_id}
            onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
            <option value="">Type de dechet</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <select className="input" value={form.frequency}
              onChange={(event) => setForm({ ...form, frequency: event.target.value })}>
              <option value="weekly">Chaque semaine</option>
              <option value="biweekly">Toutes les 2 semaines</option>
              <option value="monthly">Chaque mois</option>
            </select>
            <input className="input" type="time" required value={form.preferred_time}
              onChange={(event) => setForm({ ...form, preferred_time: event.target.value })} />
          </div>
          {form.frequency === 'monthly' ? (
            <input className="input" type="number" min="1" max="28" value={form.day_of_month}
              onChange={(event) => setForm({ ...form, day_of_month: Number(event.target.value) })} />
          ) : (
            <select className="input" value={form.day_of_week}
              onChange={(event) => setForm({ ...form, day_of_week: Number(event.target.value) })}>
              {['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'].map((day, index) => (
                <option key={day} value={index}>{day}</option>
              ))}
            </select>
          )}
          <StructuredAddressFields
            value={form}
            onChange={next => setForm({
              ...form,
              ...next,
              address: next.address_line,
            })}
          />
          <button type="button" onClick={locate}
            className={`btn-outline justify-center ${form.latitude ? 'border-green-500 text-green-700' : ''}`}>
            <MapPin size={17} /> {form.latitude ? 'Position enregistree' : 'Ajouter la position GPS'}
          </button>
          <input className="input" type="number" min="1" max="20" value={form.quantity_number}
            onChange={(event) => setForm({ ...form, quantity_number: Number(event.target.value) })} />
          <textarea className="input" placeholder="Instructions optionnelles" value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          <button className="btn-primary justify-center" disabled={submitting}>
            {submitting ? <Loader2 size={17} className="spinner" /> : <CalendarClock size={17} />}
            Programmer
          </button>
        </form>

        <div className="flex flex-col gap-3">
          {schedules.length === 0 && (
            <div className="card p-10 text-center text-gray-400">Aucun programme recurrent.</div>
          )}
          {schedules.map((schedule) => (
            <div key={schedule.uuid} className="card p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#E8F5EE] flex items-center justify-center">
                <CalendarClock className="text-[#1A8A3C]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{schedule.category_id?.name}</p>
                <p className="text-sm text-gray-500 truncate">{schedule.address}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Prochaine collecte: {new Date(schedule.next_run_at).toLocaleString()}
                </p>
              </div>
              <button onClick={() => toggle(schedule)} className="btn-outline p-2"
                title={schedule.is_active ? 'Suspendre' : 'Reprendre'}>
                {schedule.is_active ? <Pause size={17} /> : <Play size={17} />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
