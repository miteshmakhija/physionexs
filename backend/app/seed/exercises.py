"""Starter exercise library (DRAFT CONTENT).

These entries were drafted to seed the library and have NOT been clinically reviewed. They are
inserted with status "in_review"; a Physionexs physiotherapist must check every field and publish
each one from Super Admin → Exercise library before patients can see it.
"""

from dataclasses import dataclass, field


@dataclass
class Draft:
    name: str
    body_region: str
    category: str
    position: str | None
    steps: list[str]
    cues: str
    common_mistakes: str
    precautions: str
    conditions: list[str] = field(default_factory=list)
    equipment: list[str] = field(default_factory=list)
    difficulty: int = 1
    dose_unit: str = "reps"
    default_sets: int = 3
    default_reps: int | None = 10
    default_hold_seconds: int | None = None
    default_rest_seconds: int = 30


def hold(seconds: int, sets: int = 3) -> dict:
    return {"dose_unit": "seconds", "default_reps": None, "default_hold_seconds": seconds, "default_sets": sets}


EXERCISES: list[Draft] = [
    # ── Knee ────────────────────────────────────────────────────────────────
    Draft("Quadriceps sets (static quads)", "knee", "strength", "supine",
          ["Lie or sit with the leg straight and a small rolled towel under the knee.", "Tighten the thigh muscle and press the back of the knee down into the towel.", "Hold, then relax fully."],
          "Feel the kneecap glide upward as the thigh tightens.", "Holding the breath; lifting the heel instead of pressing the knee down.",
          "Stop if pain increases sharply at the front of the knee.", ["Post-surgical knee", "ACL reconstruction", "Knee osteoarthritis", "Patellofemoral pain"],
          ["Towel"], 1, **hold(5, 3), default_rest_seconds=10),
    Draft("Straight leg raise", "knee", "strength", "supine",
          ["Lie on your back, other knee bent with the foot flat.", "Tighten the thigh of the straight leg.", "Lift the straight leg to the height of the other knee.", "Lower slowly with control."],
          "Keep the knee fully straight throughout the lift.", "Letting the knee bend; arching the lower back.",
          "Avoid if you cannot keep the knee straight (quad lag) — do quadriceps sets first.", ["Post-surgical knee", "Knee osteoarthritis", "MCL sprain"], difficulty=1),
    Draft("Short arc quads", "knee", "strength", "supine",
          ["Lie with a rolled towel or bolster under the knee.", "Straighten the knee by lifting the heel, keeping the back of the knee on the roll.", "Hold briefly at the top, then lower slowly."],
          "Squeeze the thigh at full straightening.", "Lifting the thigh off the roll; moving too fast.",
          "Keep within a pain-free range.", ["Patellofemoral pain", "Post-surgical knee", "Knee osteoarthritis"], ["Towel roll"], 1),
    Draft("Heel slides", "knee", "mobility", "supine",
          ["Lie on your back with legs straight.", "Slowly slide the heel toward your buttock, bending the knee as far as comfortable.", "Pause, then slide back to straight."],
          "Move slowly and smoothly; a gentle stretch is fine.", "Forcing past a sharp pain; lifting the hip.",
          "Follow any range-of-motion limits given after surgery.", ["Post-surgical knee", "Knee replacement", "Knee stiffness"], difficulty=1, default_reps=15),
    Draft("Terminal knee extension with band", "knee", "strength", "standing",
          ["Loop a resistance band behind the knee and anchor it in front of you at knee height.", "Stand with the knee slightly bent.", "Straighten the knee fully against the band, squeezing the thigh.", "Return slowly to slightly bent."],
          "Push the back of the knee straight back, not the hip.", "Locking into hyperextension; leaning the trunk.",
          "Keep the movement small and controlled.", ["ACL reconstruction", "MCL sprain", "Patellofemoral pain"], ["Resistance band"], 2, default_reps=15),
    Draft("Wall squat (wall sit)", "knee", "strength", "standing",
          ["Stand with your back against a wall, feet hip-width and about a foot forward.", "Slide down until knees are bent to a comfortable depth (no more than 60–90°).", "Hold, then slide back up."],
          "Knees stay in line with the second toe; weight through the heels.", "Knees collapsing inward; going too deep too soon.",
          "Reduce the depth if you feel pain at the front of the knee.", ["Patellofemoral pain", "MCL sprain", "Knee osteoarthritis"], [], 2, **hold(20, 3)),
    Draft("Mini squats", "knee", "strength", "standing",
          ["Stand holding a stable surface, feet hip-width apart.", "Bend knees and hips slightly as if sitting back into a chair (about a quarter squat).", "Return to standing, squeezing the buttocks."],
          "Chest up, knees tracking over the toes.", "Knees drifting inward; heels lifting.",
          "Use support for balance; stay pain-free.", ["Knee osteoarthritis", "MCL sprain", "Post-surgical knee"], [], 2, default_reps=12),
    Draft("Step-ups", "knee", "functional", "standing",
          ["Stand facing a low step, holding a rail if needed.", "Step up with the affected leg and straighten it fully.", "Bring the other foot up, then step down leading with the unaffected leg."],
          "Push through the whole foot of the leg on the step.", "Pushing off with the back leg; knee collapsing inward.",
          "Start with a low step (10–15 cm).", ["ACL reconstruction", "Knee osteoarthritis", "Knee replacement"], ["Step"], 3),
    Draft("Standing hamstring curl", "knee", "strength", "standing",
          ["Stand holding a chair.", "Bend the knee, bringing the heel toward the buttock.", "Lower slowly."],
          "Keep thighs level; move from the knee only.", "Swinging the leg; arching the back.",
          "Add a light ankle weight only when easy and pain-free.", ["ACL reconstruction", "Knee rehab"], [], 1, default_reps=12),
    Draft("Seated knee extension", "knee", "strength", "sitting",
          ["Sit tall on a chair.", "Straighten one knee fully and tighten the thigh.", "Hold briefly, then lower slowly."],
          "Keep the thigh resting on the chair.", "Kicking up quickly; leaning back.",
          "Avoid ankle weights after ACL reconstruction unless advised.", ["Knee osteoarthritis", "Patellofemoral pain"], [], 1, default_reps=12),

    # ── Hip ─────────────────────────────────────────────────────────────────
    Draft("Glute bridge", "hip", "strength", "supine",
          ["Lie on your back, knees bent, feet flat hip-width apart.", "Tighten the buttocks and lift the hips until the body is in a straight line from shoulders to knees.", "Hold briefly, then lower slowly."],
          "Squeeze the buttocks before lifting; ribs down.", "Arching the lower back; pushing through the toes.",
          "Stop if it causes back pain; lift lower.", ["Low back pain", "Knee rehab", "Hip weakness"], [], 1, default_reps=12),
    Draft("Clamshells", "hip", "strength", "side_lying",
          ["Lie on your side with hips and knees bent, feet together.", "Keeping feet touching, lift the top knee.", "Lower slowly."],
          "Keep the pelvis still — don't roll backward.", "Rolling the hip back; moving too fast.",
          "Add a band around the thighs only when easy.", ["Patellofemoral pain", "Hip weakness", "IT band syndrome"], ["Resistance band (optional)"], 1, default_reps=15),
    Draft("Side-lying hip abduction", "hip", "strength", "side_lying",
          ["Lie on your side, bottom knee bent for balance, top leg straight.", "Lift the top leg slightly backward and up, toes pointing forward.", "Lower slowly."],
          "Lead with the heel; keep the body in a straight line.", "Rolling the pelvis back; lifting too high.",
          "Keep the movement pain-free.", ["Hip weakness", "Knee rehab", "Low back pain"], [], 2, default_reps=12),
    Draft("Kneeling hip flexor stretch", "hip", "stretch", "kneeling",
          ["Kneel on one knee (use a cushion), other foot flat in front.", "Tuck the pelvis under and shift gently forward until you feel a stretch at the front of the hip.", "Hold, breathing slowly."],
          "Squeeze the buttock of the kneeling leg.", "Arching the back; lunging too far.",
          "Avoid if kneeling hurts your knee — use a standing version.", ["Low back pain", "Hip tightness"], ["Cushion"], 1, **hold(30, 3)),
    Draft("Standing hip extension", "hip", "strength", "standing",
          ["Stand holding a chair.", "Keeping the knee straight, move the leg backward.", "Return slowly."],
          "Squeeze the buttock; keep the trunk upright.", "Leaning forward; arching the back.",
          "Small range is enough.", ["Hip weakness", "Hip replacement", "Balance"], [], 1, default_reps=12),

    # ── Ankle & foot ───────────────────────────────────────────────────────
    Draft("Ankle pumps", "ankle", "mobility", "supine",
          ["Lie or sit with the legs straight.", "Pull the toes up toward you, then point them away.", "Keep a steady rhythm."],
          "Move through the full comfortable range.", "Moving only the toes, not the ankle.",
          "Useful after surgery to help circulation — follow your surgeon's advice.", ["Ankle sprain", "Post-surgical", "Swelling"], [], 1, default_sets=2, default_reps=20, default_rest_seconds=15),
    Draft("Ankle alphabet", "ankle", "mobility", "sitting",
          ["Sit with the foot off the floor.", "Trace the letters A to Z with your big toe.", "Keep the movement at the ankle."],
          "Make the letters as big as comfortable.", "Moving the whole leg.",
          "Stay within a comfortable range after a sprain.", ["Ankle sprain", "Ankle stiffness"], [], 1, default_sets=2, default_reps=1),
    Draft("Calf raises", "ankle", "strength", "standing",
          ["Stand holding a support, feet hip-width.", "Rise up onto the balls of both feet.", "Lower slowly."],
          "Keep weight over the big and second toes.", "Rolling outward; bouncing.",
          "Progress to single-leg only when pain-free.", ["Ankle sprain", "Achilles tendinopathy", "Calf weakness"], [], 2, default_reps=15),
    Draft("Seated calf stretch with towel", "ankle", "stretch", "sitting",
          ["Sit with the leg straight and a towel around the ball of the foot.", "Gently pull the towel to bring the toes toward you.", "Hold."],
          "Keep the knee straight.", "Pulling too hard; bending the knee.",
          "A gentle stretch only.", ["Achilles tendinopathy", "Plantar fasciitis", "Calf tightness"], ["Towel"], 1, **hold(30, 3)),

    # ── Balance ─────────────────────────────────────────────────────────────
    Draft("Single-leg stance", "balance", "balance", "standing",
          ["Stand next to a counter.", "Lift one foot and balance on the other.", "Touch the counter only if needed."],
          "Stand tall, eyes on a fixed point.", "Locking the standing knee; leaning.",
          "Always have support nearby to prevent falls.", ["Ankle sprain", "Falls prevention", "Knee rehab"], [], 2, **hold(30, 3)),
    Draft("Tandem stance", "balance", "balance", "standing",
          ["Stand next to a counter.", "Place one foot directly in front of the other, heel to toe.", "Hold, then switch feet."],
          "Breathe normally and look ahead.", "Looking down at the feet.",
          "Keep support within reach.", ["Falls prevention", "Balance", "Neuro rehab"], [], 2, **hold(30, 3)),
    Draft("Sit to stand", "balance", "functional", "sitting",
          ["Sit near the front of a sturdy chair, feet slightly behind the knees.", "Lean forward and stand up without using your hands if possible.", "Sit back down slowly."],
          "Nose over toes as you rise.", "Dropping into the chair; knees collapsing inward.",
          "Use the armrests if needed.", ["Knee osteoarthritis", "Falls prevention", "Hip replacement"], ["Chair"], 2, default_reps=10),

    # ── Lumbar spine ────────────────────────────────────────────────────────
    Draft("Pelvic tilts", "lumbar", "mobility", "supine",
          ["Lie on your back, knees bent, feet flat.", "Flatten the lower back into the floor by tightening the stomach and tilting the pelvis.", "Relax back to neutral."],
          "Small, gentle movement.", "Holding the breath; pushing with the legs.",
          "Should be pain-free.", ["Low back pain", "Pregnancy-related back pain"], [], 1, default_reps=15),
    Draft("Knee-to-chest stretch", "lumbar", "stretch", "supine",
          ["Lie on your back, knees bent.", "Bring one knee toward the chest, holding behind the thigh.", "Hold, then switch."],
          "Relax the shoulders and neck.", "Pulling on the kneecap; lifting the head.",
          "Stop if it causes leg pain or tingling.", ["Low back pain", "Back stiffness"], [], 1, **hold(20, 3)),
    Draft("Cat-camel", "lumbar", "mobility", "quadruped",
          ["Start on hands and knees.", "Slowly round the back up toward the ceiling.", "Then gently let the back sag while lifting the head.", "Move smoothly between the two."],
          "Move with the breath.", "Moving too fast; forcing the end range.",
          "Keep it comfortable; avoid if kneeling hurts.", ["Low back pain", "Back stiffness"], [], 1, default_reps=10),
    Draft("Bird dog", "lumbar", "strength", "quadruped",
          ["Start on hands and knees, back flat.", "Extend one arm forward and the opposite leg back.", "Hold, then return and switch sides."],
          "Keep the hips level — imagine a glass of water on your back.", "Arching the back; rotating the hips.",
          "Start with legs only if balance is hard.", ["Low back pain", "Core stability"], [], 2, default_reps=8),
    Draft("Prone press-up", "lumbar", "mobility", "prone",
          ["Lie face down with hands under the shoulders.", "Press up, straightening the arms while the hips stay on the floor.", "Lower slowly."],
          "Let the lower back relax and sag.", "Lifting the hips; tensing the buttocks.",
          "Stop if leg symptoms get worse or spread further down the leg.", ["Low back pain", "Disc-related back pain"], [], 2, default_reps=10),
    Draft("Lower trunk rotation", "lumbar", "mobility", "supine",
          ["Lie on your back, knees bent together.", "Slowly let both knees fall to one side.", "Return to centre and repeat to the other side."],
          "Keep the shoulders on the floor.", "Letting the knees drop quickly.",
          "Stay within a comfortable range.", ["Low back pain", "Back stiffness"], [], 1, default_reps=10),
    Draft("Dead bug", "lumbar", "strength", "supine",
          ["Lie on your back, arms up, hips and knees bent to 90°.", "Slowly lower one arm and the opposite leg toward the floor.", "Return and switch sides."],
          "Keep the lower back gently pressed to the floor.", "Arching the back; holding the breath.",
          "Reduce the range if the back lifts.", ["Core stability", "Low back pain"], [], 3, default_reps=8),

    # ── Cervical spine ──────────────────────────────────────────────────────
    Draft("Chin tucks", "cervical", "strength", "sitting",
          ["Sit or stand tall.", "Gently draw the chin straight back, making a 'double chin'.", "Hold, then relax."],
          "Keep the eyes level — don't nod down.", "Tilting the head down; pushing too hard.",
          "Stop if it causes dizziness or arm symptoms.", ["Neck pain", "Posture", "Cervicogenic headache"], [], 1, **hold(5, 3), default_rest_seconds=10),
    Draft("Upper trapezius stretch", "cervical", "stretch", "sitting",
          ["Sit tall and hold the seat with one hand.", "Tilt the ear toward the opposite shoulder.", "Hold, then switch sides."],
          "Keep the shoulder down on the side being stretched.", "Rotating the head; shrugging.",
          "Gentle stretch only; stop if you feel tingling in the arm.", ["Neck pain", "Posture", "Tension headache"], [], 1, **hold(30, 3)),
    Draft("Neck rotation", "cervical", "mobility", "sitting",
          ["Sit tall.", "Slowly turn the head to look over one shoulder.", "Return to centre, then turn to the other side."],
          "Keep the chin level.", "Moving quickly; shrugging the shoulders.",
          "Stop if you feel dizzy.", ["Neck stiffness", "Neck pain"], [], 1, default_reps=10),
    Draft("Scapular retraction", "cervical", "strength", "sitting",
          ["Sit or stand tall with arms by your sides.", "Squeeze the shoulder blades back and down.", "Hold, then relax."],
          "Imagine sliding the shoulder blades into your back pockets.", "Shrugging; arching the lower back.",
          "Should be comfortable.", ["Posture", "Neck pain", "Shoulder impingement"], [], 1, **hold(5, 3), default_rest_seconds=10),
    Draft("Thoracic extension over chair", "thoracic", "mobility", "sitting",
          ["Sit in a chair with a firm back that ends below the shoulder blades.", "Hands behind the head, gently lean back over the chair.", "Return to upright."],
          "Move from the upper back, not the neck.", "Pulling on the head; arching the lower back.",
          "Keep it gentle.", ["Posture", "Upper back stiffness", "Neck pain"], ["Chair"], 1, default_reps=10),

    # ── Shoulder ────────────────────────────────────────────────────────────
    Draft("Pendulum exercise", "shoulder", "mobility", "standing",
          ["Lean forward supporting yourself with the good arm on a table.", "Let the affected arm hang down relaxed.", "Gently sway the body so the arm swings in small circles."],
          "The arm stays relaxed — the body creates the movement.", "Using the shoulder muscles to swing the arm.",
          "Follow your surgeon's guidance after shoulder surgery.", ["Frozen shoulder", "Post-surgical shoulder", "Rotator cuff"], [], 1, default_sets=2, default_reps=20, default_rest_seconds=15),
    Draft("Wall walk (finger climb)", "shoulder", "mobility", "standing",
          ["Stand facing a wall.", "Walk the fingers up the wall as high as comfortable.", "Walk them back down slowly."],
          "Step closer to the wall as the range improves.", "Shrugging the shoulder; arching the back.",
          "Mild stretch is okay; avoid sharp pain.", ["Frozen shoulder", "Shoulder stiffness"], [], 1, default_reps=10),
    Draft("External rotation with band", "shoulder", "strength", "standing",
          ["Hold a band with elbows bent at 90° and tucked to your sides.", "Rotate the forearm of the affected arm outward.", "Return slowly."],
          "Keep the elbow pressed to your side (a towel roll helps).", "Letting the elbow drift away; moving fast.",
          "Use light resistance.", ["Rotator cuff", "Shoulder impingement", "Shoulder instability"], ["Resistance band"], 2, default_reps=12),
    Draft("Internal rotation with band", "shoulder", "strength", "standing",
          ["Anchor a band at elbow height to your side.", "With the elbow bent at 90° against your side, rotate the forearm in across the body.", "Return slowly."],
          "Elbow stays tucked.", "Twisting the trunk.",
          "Use light resistance.", ["Rotator cuff", "Shoulder instability"], ["Resistance band"], 2, default_reps=12),
    Draft("Band rows", "shoulder", "strength", "standing",
          ["Anchor a band in front of you at chest height.", "Pull the ends back, bending the elbows and squeezing the shoulder blades.", "Return slowly."],
          "Shoulders down away from the ears.", "Shrugging; leaning back.",
          "Keep resistance light to moderate.", ["Posture", "Shoulder impingement", "Neck pain"], ["Resistance band"], 2, default_reps=12),
    Draft("Cross-body shoulder stretch", "shoulder", "stretch", "standing",
          ["Bring the affected arm across the chest.", "Use the other hand to gently press it closer at the elbow.", "Hold."],
          "Keep the shoulder down.", "Rotating the trunk; pulling at the wrist.",
          "Gentle stretch only.", ["Shoulder stiffness", "Posterior capsule tightness"], [], 1, **hold(30, 3)),
    Draft("Wall push-up", "shoulder", "strength", "standing",
          ["Stand an arm's length from a wall, hands on the wall at shoulder height.", "Bend the elbows to bring the chest toward the wall.", "Push back to start."],
          "Keep the body straight like a plank.", "Sagging at the hips; flaring the elbows.",
          "Move feet closer to make it easier.", ["Shoulder rehab", "Upper body strength"], [], 2, default_reps=10),

    # ── Breathing ───────────────────────────────────────────────────────────
    Draft("Diaphragmatic breathing", "breathing", "breathing", "supine",
          ["Lie with knees bent, one hand on the chest and one on the belly.", "Breathe in slowly through the nose, letting the belly rise.", "Breathe out slowly through pursed lips."],
          "The chest hand should stay fairly still.", "Lifting the shoulders; breathing too fast.",
          "Stop and rest if you feel light-headed.", ["Post-surgical", "Stress", "Respiratory rehab"], [], 1, default_sets=2, default_reps=10, default_rest_seconds=30),
]
